# Run Misty on Windows, and test calls on two computers

Everything to get the desktop app running on a Windows 10 (1709 or later) or Windows 11 computer, a server that
has calls on, and the steps for testing calls between two computers. Commands are PowerShell.

## What doesn't work on Windows yet

Know these before testing, so a gap isn't mistaken for a bug:

- **Engines' no-asking modes.** They're offered only where the engine's folder sandbox runs (macOS, and Linux
  with bwrap), so Windows shows only the asking modes.
- **Space apps' own tools** (an app's program, `apps/program.rs`) don't run, since Misty can't confine them on
  Windows yet. Pictures of an app's window aren't taken either.
- **Screen share in a call** goes through WebView2 and hasn't been tried on Windows.
- **`misty doctor desktop`** checks Node, npm and Rust only, not Visual Studio or WebView2.

## Speech on Windows

Speech recognition uses Windows' own offline recognizer (System.Speech), run in PowerShell like the system voice
(`voice/speech_recognition/src/windows.rs`). Nothing is sent anywhere. It hears the microphone, a capture's
channel and recorded files, so dictation, Tutor, transcribing a file and an agent in a call all work. It is new
and hasn't been tried on a Windows computer yet, so check it first:

1. Add your language's speech recognition: Settings › Time & language › Speech, and under Language add the
   language with its speech recognition. Windows' offline recognizer covers English (US and UK), French, German,
   Spanish, Japanese and Chinese.
2. Let desktop apps use the microphone: Settings › Privacy & security › Microphone.
3. In Misty, dictate into a chat's message box, and talk to Tutor. If Misty says the language isn't available,
   step 1 isn't done; if it can't open the microphone, step 2 isn't.

Windows' recognizer is older and less accurate than macOS's, and a recorded file is recognized phrase by phrase
rather than word by word, so captions are coarser.

## 1. Install the tools

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Rustlang.Rustup -e
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
winget install --id Microsoft.EdgeWebView2Runtime -e
winget install --id GitHub.cli -e
```

Open a new terminal, then check the versions. Node must be 24.12 or newer and npm 11 or newer; `rust-toolchain.toml`
installs Rust 1.91.0 the first time you build.

```powershell
node -v
npm -v
rustup show
```

If npm is older than 11, run `npm install -g npm@11`. WebView2 is already part of Windows 11; the line above only
matters on Windows 10.

## 2. Get the code

`misty`, `misty-ui` and `misty-sdk` must sit side by side: the app builds against both from source
(`file:../misty-ui`, `file:../misty-sdk/packages/sdk`).

```powershell
mkdir $HOME\misty-org
cd $HOME\misty-org
gh auth login
gh repo clone misty-org/misty
gh repo clone misty-org/misty-ui
gh repo clone misty-org/misty-sdk
cd misty-ui;  npm ci; cd ..
cd misty-sdk; npm ci; cd ..
cd misty;     npm ci
```

## 3. Run the app

```powershell
cd $HOME\misty-org\misty
npm run tauri dev
```

The first build takes a while. On Windows the dev runner starts a copy of the app (`tasks/run-windows-desktop.ts`),
so a rebuild isn't blocked by the running one.

To build the installer instead, run `npm run tauri -- build --bundles nsis`. It writes a per-user installer to
`src-tauri\target\release\bundle\nsis\`.

If a build fails with "extern location for … does not exist", the build folder was half-deleted. Rebuild it:

```powershell
cd src-tauri; cargo clean; cargo build; cd ..
```

If the app opens on Vite's error overlay with "Failed to resolve import", the file it names is missing from the repo,
not just from this computer. `.gitignore` leaves out folders by name (`**/sessions`, `**/config/`, `**/bin/`), so
a source folder with one of those names never gets pushed unless `.gitignore` has a `!` exception for it. The computer
it was written on still has it, so it works there and breaks everywhere else. Fix it on that computer: add the
`!` exception, then add and push the folder.

When you add a source folder named `sessions`, `config` or `bin`, add its `!` exception to `.gitignore` in the same
commit, under "Source folders whose names match the rules above."

## 4. A server with calls on

Both computers have to use the same server, with calls on. The local dev stack (`misty server up`) has no
LiveKit, so it can't carry calls. Use a server set up as in misty-docs'
[Set up a server](https://github.com/misty-org/misty-docs/blob/main/content/self-hosting/set-up-a-server.md), on a
computer that stays on: a VPS, or your Mac.

1. Follow that guide, with `MISTY_ENVIRONMENT=production` and `MISTY_CALLS=1` in
   `~/.misty/.env/server/misty.env`.
2. Start it with calls: `docker compose --profile calls up -d`.
3. Open these to the internet on that computer (on a home network, forward them on the router to it): UDP `3478`,
   UDP `50000-50100` and TCP `7881`. Sound and video go straight there, not through Cloudflare.
4. Check `https://<your hostname>/health` answers.

On each computer, open Misty, choose **Use my own server** and enter `https://<your hostname>`. The call buttons
in a direct message show only once the server says calls are on, so seeing them is the check that calls work.

## 5. The two-computer run

Use two accounts: one on the Mac, one on Windows.

**Get ready**

1. Make the two accounts friends: **Friends** › **Add friend** on one, accept on the other.
2. Make a shared Space on one account and invite the other.

**DM call, camera and screen share, across networks**

1. Put one computer on a different network from the other, such as a phone's hotspot.
2. Open the direct message and start a voice call; the other computer rings. Accept.
3. Check both hear each other. Turn on the camera on both, then share a screen from each in turn.
4. Leave and call again: a new key is made when someone leaves, so the second call must still connect.

**A Space voice channel**

1. In the shared Space, **New channel** › Voice.
2. Click the channel's row on both computers. Each sees the other listed under the row, with a ring while
   they speak.
3. Leave from one; it drops off the other's list.

Eight people and a refused ninth need nine accounts on nine computers; the server's tests already check the cap
(`misty-server/internal/platform/httpapi/realtime_voice_test.go`). With two computers, check the parts above.

**An app seeing the channel through `misty.calls`**

No app uses `misty.calls` yet, so there is nothing to open for this check. It waits for an app that does (the API
is in `misty-sdk/docs/voice-calls.md`).

**An agent in a call**

1. In a call, choose **Agents** on one computer and pick one of your agents.
2. Ask it something. Its answer is spoken on both computers, each in its own system voice.
3. Check the other computer heard the answer, and that what you said is in the agent's own thread.
4. Do it again from the other computer, so both the Mac and Windows are heard.

**If a call won't connect**

- "The call couldn't connect.": calls are off on the server, or the server can't be reached at its calls
  hostname (`<first part>-calls.<rest of your hostname>`).
- Connects but no sound or picture across networks: the UDP ports above aren't reachable from outside.
