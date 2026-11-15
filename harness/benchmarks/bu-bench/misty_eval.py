"""Run BU Bench V2 with Misty's own browser harness, scored by BU Bench's findings judge.

Each task is an ordinary agent run on one of Misty's engines (Claude Code, Codex, Gemini CLI,
...), started in Misty's debug app through its eval bridge
(Misty's `src-tauri/features/browser/agent_pages/eval_bridge`). The run browses with Misty's own browser
tools. This file saves what the judge reads in the same layout a BrowserCode run leaves, then
scores it with the benchmark's own code, unchanged: the same task decryption, judge model,
prompt and weighted scoring as `run_eval.py`.

    uv run --project ../benchmark python benchmarks/bu-bench/misty_eval.py --bench ../benchmark --tasks 5

Setup and caveats: benchmarks/bu-bench/README.md.
"""

import argparse
import asyncio
import base64
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import traceback
import uuid
from datetime import UTC, datetime
from pathlib import Path

import httpx

HERE = Path(__file__).resolve()
HARNESS = HERE.parents[2]
# The Misty checkout the debug app runs from: the bridge loads the app's modules from its src/.
# Set by --misty; the sibling checkout by default.
MISTY = HARNESS.parent / "misty"
BRIDGE = os.environ.get("MISTY_BROWSER_EVAL_BRIDGE", "http://127.0.0.1:47123").rstrip("/")
TERMINAL = re.compile(r"^invocation\.(completed|failed|canceled)$")

# Adapted from the benchmark's BrowserCode prompt (bcode_runner.PRE_PROMPT): the same deliverable,
# evidence and search instructions, with Misty's browser in place of BrowserCode's. Nobody answers
# questions during a benchmark run, so the run is told not to ask any.
PRE_PROMPT = """You are an agent with browser access working autonomously to complete a task. Nobody is watching this run: don't ask questions or wait for approval; make reasonable assumptions and state them in your final response.
Use Misty's browser tools for every website you visit, not your own web fetch or web search tools.
Save every file deliverable under {outputs}. Those files and your final response are returned to the user.
Use the browser and available tools to obtain evidence. Your final response should be clear and honest.
To search the web, prefer DuckDuckGo. If using Google, open its homepage and type the query instead of opening a cold search URL.

Task: {task}"""

# Scripts the bridge runs in the app's window, with the app's own modules (`module`) and the
# request (`request`). Module paths are relative to misty/src.
AGENT_SCRIPT = """
const { personalAgentsApi } = await module("features/agents/personal/personalAgentsApi.ts");
const { agentAccountId } = await module("features/agents/personal/agentAccount.ts");
const { invoke } = await module("native/invoke.ts");
const { agents } = await personalAgentsApi.list();
const agent = agents.find((candidate) => candidate.id === request.agentId);
if (!agent) return { agent: null, agents: agents.map((candidate) => candidate.id) };
const folder = await invoke("agent_folder", { account: agentAccountId(), agent: agent.id });
return { agent: { id: agent.id, name: agent.name, engine: agent.engine ?? "", folder: folder ?? null } };
"""
START_SCRIPT = """
const { aiSurfaceApi } = await module("features/agents/runs/invocations/api.ts");
return aiSurfaceApi.createInvocation(request);
"""
STEPS_SCRIPT = """
const { activityApi } = await module("features/agents/activity/activityApi.ts");
return activityApi.steps(request.runId);
"""
PICTURE_SCRIPT = """
const { activityApi } = await module("features/agents/activity/activityApi.ts");
return activityApi.picture(request.runId, request.picture);
"""
# The window's profile, whose website data store the runs' pages browse in.
PROFILE_SCRIPT = """
const { invoke } = await module("native/invoke.ts");
const info = await invoke("profile_window_info");
return { window: info.label, profile: info.profile.name };
"""
# Clears that profile's cookies, site storage and cache (Settings, Clear website data), so a task
# starts in a clean browser as BrowserCode's do.
CLEAR_SCRIPT = """
const { invoke } = await module("native/invoke.ts");
await invoke("browser_clear_website_data", { request: { kinds: ["cookies", "cache"], since: 0 } });
return true;
"""


# The engine's own ways onto the web, which bypass Misty's browser: its fetch and search tools, and
# shell commands that open URLs. A run that used one is reported as contaminated, apart from the
# score, since the prompt only asks the engine not to (README, "How it differs").
WEB_TOOLS = re.compile(r"(^|[_.])(web_?fetch|web_?search|fetch_url|http_get|browse_url)$", re.I)
SHELL_TOOLS = re.compile(r"(^|[_.])(bash|shell|exec|run_command|terminal)$", re.I)
SHELL_WEB = re.compile(r"\b(curl|wget|httpie|lynx|w3m)\b|https?://|urllib|requests\.(get|post)|fetch\(", re.I)


def bypass_of(name: str, arguments) -> str | None:
    """Why a tool call reached the web without Misty's browser, or None."""
    bare = (name or "").rsplit("__", 1)[-1]
    if is_browser_tool(name):
        return None
    if WEB_TOOLS.search(bare):
        return bare
    if SHELL_TOOLS.search(bare) and SHELL_WEB.search(json.dumps(arguments, default=str)):
        return f"{bare} reaching the web"
    return None


def is_browser_tool(name: str) -> bool:
    """The same test `run_control/step_pictures.rs` uses to picture a step."""
    bare = (name or "").rsplit("__", 1)[-1]
    return bare.startswith(("browser.", "browser_"))


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(data, indent=2, ensure_ascii=False, default=str))
    temporary.replace(path)


class Bridge:
    """The debug app's eval bridge: scripts in a window, and following or cancelling a run."""

    def __init__(self, client: httpx.AsyncClient, token: str, window: str | None):
        self.client, self.token, self.window = client, token, window

    async def call(self, path: str, body: dict, timeout: float = 60):
        response = await self.client.post(
            BRIDGE + path,
            json=body,
            headers={"authorization": f"Bearer {self.token}"},
            timeout=timeout,
        )
        if response.status_code == 401:
            raise RuntimeError("The eval bridge refused the token; check MISTY_BROWSER_EVAL_BRIDGE_TOKEN")
        reply = response.json()
        if not reply.get("ok"):
            raise RuntimeError(f"{path}: {reply.get('error') or response.status_code}")
        return reply.get("result")

    async def run_script(self, script: str, request=None, timeout_ms: int = 120_000):
        prelude = (
            f'const module = (path) => import("/@fs{MISTY.as_posix()}/src/" + path);\n'
            f"const request = {json.dumps(request)};\n"
        )
        body = {"script": prelude + script, "timeoutMs": timeout_ms}
        if self.window:
            body["window"] = self.window
        return await self.call("/window-eval", body, timeout=timeout_ms / 1000 + 15)


class Trajectory:
    """A run's events as BU Bench's judge reads a trajectory: one string per step, as
    `bcode_runner.execute` writes them (`thinking: ...`, `text: ...`, and one JSON object per
    finished tool call)."""

    def __init__(self, events_file):
        self.events_file = events_file
        self.steps: list[str] = []
        self.final_result = ""
        self.reply = ""
        self.thinking = ""
        self.started_args: dict[str, object] = {}
        # Trajectory step numbers (1-based) of the run's own browser calls, in order.
        self.browser_steps: list[int] = []
        self.cost = 0.0
        self.notes: list[str] = []
        # Tool calls that reached the web without Misty's browser.
        self.bypasses: list[str] = []

    def flush(self) -> None:
        if self.thinking.strip():
            self.steps.append(f"thinking: {self.thinking.strip()}")
        if self.reply.strip():
            self.steps.append(f"text: {self.reply.strip()}")
            self.final_result = self.reply.strip()
        self.thinking = self.reply = ""

    def add(self, event: dict) -> None:
        self.events_file.write(json.dumps(event, ensure_ascii=False, default=str) + "\n")
        self.events_file.flush()
        kind = event.get("type", "")
        if kind == "thinking.delta":
            if self.reply.strip():
                self.flush()
            self.thinking += str(event.get("delta") or "")
        elif kind == "response.delta":
            self.reply += str(event.get("delta") or "")
        elif kind == "assistant.message":
            self.reply = str(event.get("text") or self.reply)
            self.flush()
        elif kind == "tool.started":
            self.flush()
            self.started_args[str(event.get("toolCallId"))] = event.get("args")
        elif kind in ("tool.completed", "tool.failed"):
            self.flush()
            call = str(event.get("toolCallId"))
            name = str(event.get("toolName") or "")
            arguments = event.get("args", self.started_args.pop(call, None))
            self.steps.append(
                json.dumps(
                    {
                        "tool": name,
                        "input": arguments,
                        "output": event.get("result"),
                        "error": event.get("error"),
                        "status": "completed" if kind == "tool.completed" else "error",
                    },
                    ensure_ascii=False,
                    default=str,
                )
            )
            if is_browser_tool(name) and not event.get("parentToolCallId"):
                self.browser_steps.append(len(self.steps))
            bypass = bypass_of(name, arguments)
            if bypass:
                self.bypasses.append(f"step {len(self.steps)}: {bypass}")
        elif kind == "usage.updated":
            # Claude Code reports the turn's total so far; the highest figure is the run's cost.
            self.cost = max(self.cost, float(event.get("costUsd") or 0))
        elif kind in ("approval.required", "engine.question"):
            self.notes.append(
                f"The run asked for a person's answer ({kind}); nobody answers during a benchmark run."
            )
        elif kind == "invocation.failed":
            self.flush()
            self.notes.append(f"The run failed: {event.get('error')}")


async def follow_run(bridge: Bridge, run_id: str, trajectory: Trajectory, timeout: float) -> str:
    deadline = time.monotonic() + timeout
    read = 0
    while time.monotonic() < deadline:
        follow = await bridge.call("/run-follow", {"runId": run_id})
        events = follow.get("events") or []
        for event in events[read:]:
            trajectory.add(event)
            if TERMINAL.match(event.get("type", "")):
                return event["type"]
        read = len(events)
        if follow.get("state") == "missing":
            return "stream.ended"
        await asyncio.sleep(0.5)
    return "timeout"


async def collect_screenshots(bridge: Bridge, run_id: str, trajectory: Trajectory, shots: Path):
    """The pictures Misty took of the run's page after its browser steps
    (`run_control/step_pictures.rs`), tied to trajectory steps when the counts line up."""
    frames, images, errors, notes = [], [], [], []
    rows = await bridge.run_script(STEPS_SCRIPT, {"runId": run_id})
    browser_rows = [
        row
        for row in rows or []
        if is_browser_tool(row.get("tool", "")) and not row.get("nested") and row.get("state") != "running"
    ]
    mapped = len(browser_rows) == len(trajectory.browser_steps)
    if not mapped:
        notes.append(
            f"Misty recorded {len(browser_rows)} browser steps and the trajectory has "
            f"{len(trajectory.browser_steps)}, so screenshots are not tied to step numbers."
        )
    missing = 0
    for index, row in enumerate(browser_rows):
        if not row.get("picture"):
            missing += 1
            continue
        step = trajectory.browser_steps[index] if mapped else None
        try:
            data_url = await bridge.run_script(
                PICTURE_SCRIPT, {"runId": run_id, "picture": row["picture"]}
            )
            image = data_url.split(",", 1)[1]
            name = f"{len(frames) + 1:05d}-step-{step if step is not None else 'x'}.jpg"
            (shots / name).write_bytes(base64.b64decode(image))
        except Exception as exc:  # noqa: BLE001 - keep the run's other evidence
            errors.append(f"picture {row['picture']}: {type(exc).__name__}: {exc}")
            continue
        frames.append({"path": name, "step": step, "seq": row.get("seq"), "captured_at": row.get("at")})
        images.append(image)
    if missing:
        notes.append(
            f"{missing} of {len(browser_rows)} browser steps have no screenshot: Misty pictures a run's "
            "page at most once every 1.2 seconds and skips pictures over 400 KB."
        )
    return frames, images, errors, notes


async def execute(bridge: Bridge, task: dict, task_dir: Path, *, agent: dict, args) -> dict:
    from bcode_runner import collect_outputs  # the benchmark's own deliverable reader

    shots = task_dir / "screenshots"
    outputs = task_dir / "workspace" / "outputs"
    for path in (shots, outputs):
        path.mkdir(parents=True, exist_ok=False)
    # The engine works in its agent's folder, so deliverables are saved there and copied here.
    agent_outputs = Path(agent["folder"]) / "bu-bench" / args.run_stamp / task["task_id"] / "outputs"
    agent_outputs.mkdir(parents=True, exist_ok=False)

    request = {
        "mode": "drawer",
        "surfaceId": "global",
        "trigger": "message",
        "prompt": PRE_PROMPT.format(outputs=agent_outputs, task=task["confirmed_task"]),
        "context": [],
        "agentId": agent["id"],
        "executionMode": args.execution_mode,
        "permissionMode": args.permission_mode,
        "idempotencyKey": f"bu-bench-{uuid.uuid4()}",
        "timezone": "UTC",
    }
    if args.model:
        request["modelId"] = args.model
    if args.effort:
        request["reasoningEffort"] = args.effort

    trace = {
        "final_result": "",
        "agent_steps": [],
        "screenshots_b64": [],
        "screenshot_steps": [],
        "screenshot_timing": "after",
        "output_files_text": "",
        "output_images": [],
        "evidence_errors": [],
        "evidence_notes": [],
    }
    errors: list[str] = []
    start = time.monotonic()
    run_id = None
    with (task_dir / "events.jsonl").open("w") as events_file:
        trajectory = Trajectory(events_file)
        try:
            created = await bridge.run_script(START_SCRIPT, request)
            run_id = created["invocationId"]
            write_json(task_dir / "run.json", {"runId": run_id, "conversationId": created.get("conversationId")})
            ending = await follow_run(bridge, run_id, trajectory, args.task_timeout)
            if ending == "timeout":
                errors.append(f"Task timed out after {args.task_timeout}s; grading preserved partial work")
                await bridge.call("/run-cancel", {"runId": run_id})
            elif ending != "invocation.completed":
                errors.append(f"The run ended with {ending}")
        except Exception as exc:  # noqa: BLE001 - grade whatever the run left
            errors.append(f"{type(exc).__name__}: {exc}")
        finally:
            trajectory.flush()
    errors.extend(trajectory.notes)
    trace["final_result"] = trajectory.final_result
    trace["agent_steps"] = trajectory.steps

    frames = []
    if run_id:
        try:
            frames, images, picture_errors, notes = await collect_screenshots(bridge, run_id, trajectory, shots)
            trace["screenshots_b64"] = images
            mapped = all(frame["step"] is not None for frame in frames)
            trace["screenshot_steps"] = [frame["step"] for frame in frames] if mapped else None
            trace["evidence_errors"].extend(picture_errors)
            trace["evidence_notes"].extend(notes)
        except Exception as exc:  # noqa: BLE001 - grade without pictures
            trace["evidence_errors"].append(f"Screenshots: {type(exc).__name__}: {exc}")
            trace["screenshot_steps"] = None
    write_json(task_dir / "screenshot_manifest.json", frames)

    # Copy, then remove, the deliverables, so no task material is left in the agent's folder.
    shutil.copytree(agent_outputs, outputs, symlinks=True, dirs_exist_ok=True)
    shutil.rmtree(agent_outputs.parent, ignore_errors=True)
    trace["output_files_text"], trace["output_images"], file_errors = collect_outputs(outputs)
    trace["evidence_errors"].extend(file_errors)

    metrics = {
        "steps": len(trace["agent_steps"]),
        "duration": time.monotonic() - start,
        "cost": trajectory.cost,
    }
    if trajectory.bypasses:
        metrics["contaminated"] = trajectory.bypasses
    if errors:
        trace["agent_steps"].append("Executor notes: " + "\n".join(errors))
    if trace["evidence_errors"]:
        trace["agent_steps"].append("Evidence collection errors: " + "\n".join(trace["evidence_errors"]))
    (task_dir / "trace.json").write_text(json.dumps(trace))
    return {"trace": trace, "metrics": metrics, "execution_errors": errors}


async def run_task(bridge, task, semaphore, *, run_dir, agent, args, judge_llm):
    from bcode_results import public_result
    from evaluation import judge_trace

    async with semaphore:
        task_dir = run_dir / task["task_id"]
        task_dir.mkdir()
        result = {
            "task_id": task["task_id"],
            "score": None,
            "raw_score": None,
            "steps": 0,
            "duration": 0.0,
            "cost": 0.0,
            "status": "execution_error",
        }
        phase = "execution"
        try:
            if args.store == "fresh":
                await bridge.run_script(CLEAR_SCRIPT)
            executed = await execute(bridge, task, task_dir, agent=agent, args=args)
            result.update(executed["metrics"])
            if not executed["metrics"]["steps"]:
                raise RuntimeError("The run produced no model or tool evidence; see events.jsonl")
            if executed["execution_errors"]:
                result["execution_errors"] = executed["execution_errors"]
            # Judge material is written only after the run, as in bcode_eval.py.
            write_json(task_dir / "task.json", task)
            write_json(task_dir / "result.json", {**result, "status": "awaiting_judge"})
            phase = "judge"
            result.update(await judge_trace(task, executed["trace"], judge_llm, artifact_dir=task_dir))
            result["status"] = "judged" if result["score"] is not None else "evidence_incomplete"
        except Exception as exc:  # noqa: BLE001 - keep each task's failure and go on
            result.update(
                status=f"{phase}_error",
                error=f"{type(exc).__name__}: {exc}",
                traceback=traceback.format_exc(),
            )
        write_json(task_dir / "result.json", result)
        write_json(task_dir / "public-result.json", public_result(result))
        label = f"{result['score']:.1%}" if result["score"] is not None else result["status"]
        print(f"{task['task_id']}: {label}", flush=True)
        return result


def commit_of(repository: Path) -> str | None:
    try:
        return subprocess.run(
            ["git", "-C", str(repository), "rev-parse", "HEAD"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


async def main(args) -> None:
    global MISTY
    MISTY = (args.misty or MISTY).expanduser().resolve()
    if not (MISTY / "src" / "features" / "agents").is_dir():
        raise SystemExit(f"{MISTY} is not a Misty checkout; pass --misty")
    bench = args.bench.expanduser().resolve()
    if not (bench / "BU_Bench_V2.enc").is_file():
        raise SystemExit(
            f"{bench} is not a BU Bench checkout (no BU_Bench_V2.enc). Run `git submodule update --init`, or pass --bench"
        )
    sys.path.insert(0, str(bench))
    from dotenv import load_dotenv

    load_dotenv(bench / ".env")
    from evaluation import DEFAULT_BENCHMARK, create_judge, judge_config, load_tasks

    token = os.environ.get("MISTY_BROWSER_EVAL_BRIDGE_TOKEN", "")
    if len(token) < 24:
        raise SystemExit("Set MISTY_BROWSER_EVAL_BRIDGE_TOKEN to the token the app was started with")
    # The benchmark's own selection and summary, so runs line up with run_eval.py's.
    from bcode_eval import summarize_results
    from run_eval import select_shard, select_tasks

    tasks = select_shard(load_tasks(DEFAULT_BENCHMARK), args.shard_index, args.shard_count)
    tasks = select_tasks(tasks, args.task_ids, args.tasks)
    if not tasks:
        raise SystemExit("The selected task set is empty")
    agent_id = args.agent or f"personal_engine_{args.engine}"

    async with httpx.AsyncClient() as client:
        bridge = Bridge(client, token, args.window)
        found = await bridge.run_script(AGENT_SCRIPT, {"agentId": agent_id})
        agent = found.get("agent")
        if not agent:
            raise SystemExit(
                f"No agent {agent_id} in the app. Its agents: {', '.join(found.get('agents') or [])}"
            )
        if not agent.get("folder"):
            raise SystemExit(
                f"{agent['name']} has no folder yet. Send it one message in the app so it gets one, then run again."
            )
        window = await bridge.run_script(PROFILE_SCRIPT)
        if args.store == "fresh" and window["profile"] != args.profile:
            raise SystemExit(
                f"--store fresh clears the website data of {window['window']}'s profile, "
                f"{window['profile']!r}, before every task. Pass --profile {window['profile']!r} "
                "if that profile is only for benchmarks, or --window for another window."
            )
        judge = create_judge(DEFAULT_BENCHMARK, args.judge_model, args.judge_reasoning)
        args.run_stamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S_%f")
        run_dir = (args.output_dir or HERE.parent / "run_data").expanduser().resolve() / f"BU_Bench_V2_misty_{args.run_stamp}"
        run_dir.mkdir(parents=True)
        try:
            config = {
                "benchmark": DEFAULT_BENCHMARK,
                "executor": "misty",
                "executor_config": {
                    "agent_id": agent["id"],
                    "agent_name": agent["name"],
                    "engine": agent["engine"],
                    "model": args.model or "agent default",
                    "reasoning_effort": args.effort or "agent default",
                    "permission_mode": args.permission_mode,
                    "execution_mode": args.execution_mode,
                    "browser_store": {
                        "fresh": "cleared before every task",
                        "signed-in": "the profile's own sign-ins and site data, kept between tasks",
                    }[args.store],
                    "profile": window["profile"],
                    "misty_commit": commit_of(MISTY),
                    "harness_commit": commit_of(HARNESS),
                },
                "dataset_sha256": sha256(bench / "BU_Bench_V2.enc"),
                "runner_source_sha256": sha256(HERE),
                "judge": {**judge_config(DEFAULT_BENCHMARK, judge), "screenshot_timing": "after_tool_event"},
                "task_ids": [task["task_id"] for task in tasks],
                "task_timeout_seconds": args.task_timeout,
                "parallel": args.parallel,
            }
            write_json(run_dir / "config.json", config)
            print(
                f"BU Bench V2: {len(tasks)} tasks; Misty / {agent['name']} ({agent['engine']}) / "
                f"{config['executor_config']['model']}; {args.store} browser store "
                f"({window['profile']}); findings judge {judge.model} / {judge.reasoning_effort}",
                flush=True,
            )
            if args.check:
                print(f"Preflight passed; no tasks executed. Configuration: {run_dir / 'config.json'}")
                return
            semaphore = asyncio.Semaphore(args.parallel)
            results = await asyncio.gather(
                *(
                    run_task(bridge, task, semaphore, run_dir=run_dir, agent=agent, args=args, judge_llm=judge)
                    for task in tasks
                )
            )
            summary = summarize_results(results)
            # Tasks where the engine reached the web without Misty's browser; report them apart.
            summary["contaminated_tasks"] = [r["task_id"] for r in results if r.get("contaminated")]
            if summary["contaminated_tasks"]:
                print(f"Contaminated (used the engine's own web access): {', '.join(summary['contaminated_tasks'])}")
            write_json(run_dir / "results.json", {"config": config, **summary, "task_results": results})
            if summary["mean_score"] is not None:
                print(f"Mean weighted score: {summary['mean_score']:.2%} (raw: {summary['mean_raw_score']:.2%})")
            else:
                print(
                    f"Incomplete evaluation: {summary['tasks_unscored']} unscored tasks; {summary['tasks_scored']} scored"
                )
            print(f"Results and evidence: {run_dir}")
            if summary["tasks_unscored"]:
                raise SystemExit(1)
        finally:
            shutil.rmtree(Path(agent["folder"]) / "bu-bench" / args.run_stamp, ignore_errors=True)
            judge_client = getattr(judge, "client", None)
            if judge_client is not None:
                await judge_client.close()


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--bench", type=Path, default=HERE.parent / "browser-use-benchmark", help="BU Bench checkout (default: the browser-use-benchmark submodule, v2.1.1)")
    parser.add_argument("--misty", type=Path, help="The Misty checkout the debug app runs from (default: ../misty)")
    who = parser.add_mutually_exclusive_group()
    who.add_argument("--engine", default="claude", help="Engine id whose default agent runs the tasks (claude, codex, gemini, ...)")
    who.add_argument("--agent", help="A specific agent id instead of the engine's default agent")
    parser.add_argument("--model", help="Model id for the engine; the agent's default when omitted")
    parser.add_argument("--effort", choices=["low", "medium", "high", "xhigh"], help="Reasoning effort")
    parser.add_argument("--permission-mode", default="bypass", help="The engine's mode for each run (default: bypass)")
    parser.add_argument("--execution-mode", default="user", choices=["user", "agent"])
    parser.add_argument("--window", help="App window label to start runs from; the first window when omitted")
    parser.add_argument(
        "--store", required=True, choices=["fresh", "signed-in"],
        help="fresh: clear the profile's cookies, storage and cache before every task, as the benchmark's "
        "own runs start (scores comparable with other harnesses); signed-in: browse with the profile's "
        "sign-ins, kept between tasks (reported apart)",
    )
    parser.add_argument("--profile", help="With --store fresh: the name of the profile it clears, to confirm it")
    parser.add_argument("--tasks", type=int, help="Run only the first N selected tasks")
    parser.add_argument("--task-ids", nargs="+", help="Exact task ids")
    parser.add_argument("--shard-index", type=int)
    parser.add_argument("--shard-count", type=int)
    parser.add_argument("--task-timeout", type=int, default=3600, help="Seconds per task (default: 3600)")
    parser.add_argument("--parallel", type=int, default=1, help="Runs at once in the app (default: 1)")
    parser.add_argument("--judge-model", default=None, help="Findings judge model (default: the benchmark's)")
    parser.add_argument("--judge-reasoning", default="xhigh")
    parser.add_argument("--output-dir", type=Path, help="Where results go (default: run_data/ beside this file, which git ignores)")
    parser.add_argument("--check", action="store_true", help="Check the app, agent and judge setup without running tasks")
    args = parser.parse_args(argv)
    if (args.shard_index is None) != (args.shard_count is None):
        parser.error("--shard-index and --shard-count go together")
    if args.store == "fresh" and not args.profile:
        parser.error("--store fresh needs --profile <name>, the benchmark profile whose data it clears")
    if args.store == "fresh" and args.parallel > 1:
        parser.error("--store fresh runs one task at a time: tasks running together share the store")
    if args.parallel < 1:
        parser.error("--parallel must be at least 1")
    return args


if __name__ == "__main__":
    asyncio.run(main(parse_args()))
