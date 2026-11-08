import { Button, ErrorNotification, Spinner } from "@/shared/ui";
import { Check, X } from "lucide-react";
import { DesktopSettingsRow as Row } from "@/features/settings";
import { useModelTest, type ModelTestResult } from "./modelAccounts";

/** What the check found, one line per ability, with a check or a cross. */
export function ModelTestLines({ result }: { result: ModelTestResult }) {
  return (
    <ul className="m-0 grid list-none gap-1 p-0 text-sm text-cream-muted">
      {[
        ["Tool calls", result.tools],
        ["Screenshots", result.images],
      ].map(([label, check]) => {
        const { ok, detail } = check as ModelTestResult["tools"];
        return (
          <li key={label as string} className="flex items-start gap-2">
            {ok ? (
              <Check aria-label="Works" className="mt-0.5 size-4 shrink-0 text-cream-bright" />
            ) : (
              <X aria-label="Doesn't work" className="mt-0.5 size-4 shrink-0 text-cream-bright" />
            )}
            <span>
              <span className="text-cream">{label as string}.</span> {detail}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Settings › Models: checks the agent model on the runtime on this computer. */
export function ModelTestRow(props: { disabled?: boolean }) {
  const test = useModelTest();
  return (
    <>
      <Row
        label="Check the agent model"
        description="Asks it to call a tool and read a screenshot, the two things every agent run needs."
      >
        <div className="flex w-[240px] max-w-full justify-end">
          <Button
            variant="outline"
            size="sm"
            disabled={props.disabled || test.running}
            aria-busy={test.running}
            onClick={() => void test.run()}
          >
            {test.running ? <Spinner size="sm" label={false} /> : null}
            Check
          </Button>
        </div>
      </Row>
      <ErrorNotification message={test.error} />
      {test.result ? (
        <div className="pb-4 pl-5">
          <ModelTestLines result={test.result} />
        </div>
      ) : null}
    </>
  );
}
