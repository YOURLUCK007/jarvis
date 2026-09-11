# Jarvis Desktop Agent

Jarvis is a real, local-first desktop assistant. It turns natural-language requests into a plan, shows the plan, asks for approval before risky actions, executes native computer tools, and reports actual results. It is intentionally model-provider agnostic: configure an OpenAI-compatible endpoint, or use the built-in safe planner for common local actions.

## What is implemented

- Electron desktop shell with a polished conversation UI.
- Push-to-talk speech recognition where Chromium supports Web Speech API, plus speech synthesis responses.
- Model-backed JSON planner for open-ended multi-step tasks through any OpenAI-compatible `/chat/completions` endpoint.
- Safe fallback planner for opening apps, URLs and folders, web searches, screenshots, folder creation, file search, volume controls, calculations, and cancellation.
- Native filesystem operations, app launching, browser launch, screenshots, volume controls, and command execution.
- Confirmation gate for delete, move, copy, rename, and shell command actions.
- Local conversation context, activity log, settings, privacy notice, and diagnostics.
- Cross-platform adapters for Linux, macOS, and Windows where the operating system exposes the capability.
- GitHub Actions builds for Linux AppImage/deb, macOS dmg, and Windows NSIS/portable packages.

This is a real foundation, not a hard-coded demo: new tools are added in `src/core/executor.js`, and the model planner can select them by schema. OS-specific behavior is isolated behind the executor.

## Run locally

```bash
npm install
npm start
```

Run tests:

```bash
npm test
```

Build a package for the current operating system:

```bash
npm run dist
```

The resulting installer or portable artifact is written to `dist/`.

## Configure an AI model

Open **Settings** inside the app and enter an OpenAI-compatible base URL, model name, and API key. Or create a local `.env` based on `.env.example` before starting the app. The app never needs a model key for the built-in local planner.

For a local Ollama-compatible server:

```env
MODEL_BASE_URL=http://127.0.0.1:11434/v1
MODEL_API_KEY=ollama
MODEL_NAME=llama3.2
```

For OpenAI:

```env
MODEL_BASE_URL=https://api.openai.com/v1
MODEL_API_KEY=your-key
MODEL_NAME=gpt-4o-mini
```

Use the app's Settings screen rather than committing `.env`; `.env` is ignored by Git.

## Permissions and privacy

The assistant cannot bypass OS permissions. macOS may ask for Accessibility, Screen Recording, Microphone, or Automation access. Windows and Linux desktop environments may require microphone, screen-capture, or portal permissions. The Diagnostics screen shows what this runtime can currently reach.

Local file operations and native controls run on the current computer. Requests are sent to a model provider only when one is configured. Web search opens the user's browser; it does not silently upload local files.

## Extending Jarvis

1. Add a tool to the model tool list and prompt in `src/core/model.js`.
2. Add a safe execution branch in `executeStep` in `src/core/executor.js`.
3. Add an explicit confirmation policy in `DANGEROUS_TOOLS` when the action can modify, share, or delete data.
4. Add unit coverage under `test/`.

## Packaging

Build on the target operating system with `npm run dist`. Electron Builder writes the installer or portable artifact to `dist/`. The project is also ready for a GitHub Actions workflow; if you enable Actions in your fork, use the commands above in Linux, Windows, and macOS jobs so each platform is packaged on its native runner.