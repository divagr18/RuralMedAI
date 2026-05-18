# Parchee Edge Frontend

This is the Next.js frontend for Parchee Edge.

## Run

```powershell
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

The frontend expects the FastAPI backend at `http://localhost:8003`.

## Audio Flow

- `hooks/useAudioStream.ts` captures microphone input.
- `public/worklet.js` converts browser audio into 16 kHz PCM frames.
- `app/page.tsx` streams audio frames over `/ws/live-consultation`.
- The backend performs VAD and sends speech windows to local Gemma 4 through llama.cpp.
- The UI receives `content` transcript/status messages and `update` field patches.

## Build Check

```powershell
npm run build
```
