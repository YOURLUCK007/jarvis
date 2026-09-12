# Jarvis Desktop Agent

Jarvis is a real, local-first desktop assistant. It turns natural-language requests into a plan, shows the plan, asks for approval before risky actions, executes native computer tools, and reports actual results. It is intentionally model-provider agnostic: configure an OpenAI-compatible endpoint, or use the built-in safe planner for common local actions.

## What is implemented

- Electron desktop shell with a polished conversation UI.
- Push-to-talk speech recognition plus an optional always-on wake-word listener (`Hey Jarvis`) where Chromium supports Web Speech API.
- Automatic start at login on packaged Windows, macOS, and Linux builds, with a Settings toggle.
- Model-backed JSON planner for open-ended multi-step tasks through any OpenAI-compatible `/chat/completions` endpoint.
- Safe fallback planner for common local actions, plus dynamic model-selected tools for files, applications, browser searches, clipboard, keyboard, processes, screenshots, calculations, and memory.
- Native filesystem operations, application launch/close, live DuckDuckGo web search results, screenshots, volume controls, clipboard, keyboard, and process controls.
- Confirmation gate for delete, move, copy, rename, and shell command actions.
- Local conversation context and optional memory stored in the OS user-data directory.
- Secure API-key storage through Electron `safeStorage`; the key is never returned to the renderer after saving.
- Real activity events emitted by planning, tool execution, verification, errors, and completion.
- Settings for wake word, voice, speech, computer/screen/browser/terminal permissions, confirmation mode, privacy, and start-at-login.
- Diagnostics for microphone, speaker, speech recognition, model/API key, filesystem, screen capture, browser, terminal, internet, and runtime dependencies.
- Cross-platform adapters for Linux, macOS, and Windows where the operating system exposes the capability.
- GitHub Actions builds for Linux AppImage/deb, macOS dmg, and Windows NSIS/portable packages.

This is a real foundation, not a hard-coded demo: new tools are added in `src/core/executor.js`, and the model planner can select them by schema. OS-specific behavior is isolated behind the executor.

## Run locally

```bash
npm install
npm start
```

The first run opens the command center. Allow microphone access when the operating system asks. With **Listen for wake word** enabled, leave JARVIS running and say:

```text
Hey Jarvis, open my Downloads folder.
```

JARVIS answers aloud when **Speak responses aloud** is enabled. The microphone button remains available as push-to-talk. Say or type `stop`, `cancel`, or `Jarvis stop` to interrupt the current task where the operating system allows it.

Run tests:

```bash
npm test
```

Build a package for the current operating system:

```bash
npm run dist
```

The resulting installer or portable artifact is written to `dist/`.

### Start when the laptop starts

Enable **Start JARVIS when I sign in** in Settings. Packaged builds register themselves with the operating system. During development, use the platform helper below if the operating system does not register an unpackaged Electron process:

After `npm install` works, double-click `install-autostart.bat` in the project folder. It creates a shortcut in the current Windows user's Startup folder. Jarvis will open automatically when that user signs in. To remove auto-start, delete `Jarvis Desktop.lnk` from `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`.

On macOS, package the app, open it once, allow Microphone and Accessibility permissions in System Settings, then keep **Start JARVIS when I sign in** enabled. On Linux, package the AppImage or deb and allow the desktop environment to launch it at login; screen capture and keyboard control depend on the desktop session and may require `gnome-screenshot`, `scrot`, `xdotool`, `wl-clipboard`, or `xclip`.

## Configure an AI model

Open **Settings** inside the app and enter an OpenAI-compatible base URL, model name, and API key. Or create a local `.env` based on `.env.example` before starting the app. The app never needs a model key for the built-in local planner.

For a local Ollama-compatible server:

```env
MODEL_BASE_URL=http://127.0.0.1:11434/v1
MODEL_API_KEY=ollama
MODEL_NAME=llama3.2
```

For OpenAI-compatible providers:

```env
MODEL_BASE_URL=https://api.openai.com/v1
MODEL_API_KEY=your-key
MODEL_NAME=gpt-4o-mini
```

Use the app's Settings screen rather than committing `.env`; `.env` is ignored by Git. The Settings page also includes **Test connection** and **Clear key**.

## Permissions and privacy

The assistant cannot bypass OS permissions. macOS may ask for Accessibility, Screen Recording, Microphone, or Automation access. Windows and Linux desktop environments may require microphone, screen-capture, or portal permissions. The Diagnostics screen shows what this runtime can currently reach.

Local file operations and native controls run on the current computer. Requests are sent to a model provider only when one is configured. Web search retrieves public search results from DuckDuckGo; it does not upload local files. Wake-word recognition is provided by the local Electron speech engine and may require microphone permission and an internet connection on systems whose speech engine is cloud-backed.

## Extending Jarvis

1. Add a tool to the model tool list and prompt in `src/core/model.js`.
2. Add a safe execution branch in `executeStep` in `src/core/executor.js`.
3. Add an explicit confirmation policy in `DANGEROUS_TOOLS` when the action can modify, share, or delete data.
4. Add unit coverage under `test/`.

## Packaging

Build on the target operating system with `npm run dist`. Electron Builder writes the installer or portable artifact to `dist/`. The project is also ready for a GitHub Actions workflow; if you enable Actions in your fork, use the commands above in Linux, Windows, and macOS jobs so each platform is packaged on its native runner.