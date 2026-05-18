# Parchee Edge: Gemma 4 Clinical Documentation for Low-Connectivity Care

**Track:** Health & Sciences  
**Subtitle:** A local-first medical scribe that uses Gemma 4's audio understanding and instruction-following to turn consultation speech into structured, encrypted, claim-ready records.

## Project Links

- **Public code repository:** https://github.com/PrnvKK/RuralMedAI
- **Video demo:** YouTube link placeholder

## Problem

Small clinics often run on thin infrastructure: intermittent internet, limited staff, mixed-language consultations, and heavy documentation burden. A doctor may speak with a patient in Hinglish or another code-switched language, then still has to produce structured notes, capture vitals, document procedures, preserve follow-up context, and prepare evidence for insurance or welfare claims.

Most scribe products assume cloud access and hospital-scale workflows. Parchee Edge is built for the opposite setting. It keeps the core AI loop local, gives the clinician a reviewable record, and treats AI as documentation support rather than autonomous medical advice.

## What We Built

Parchee Edge is a browser + FastAPI application powered by local Gemma 4. Gemma 4 is the reason the product can be simple: one capable open model can listen to the consultation, preserve the transcript, understand clinical context, follow a strict JSON schema, and later draft summaries and notes. The frontend captures microphone audio through an AudioWorklet as 16 kHz PCM. The backend performs adaptive voice activity detection, skips silence, converts speech windows into WAV, and sends them to Gemma 4 running in llama.cpp.

This is the key design choice: Parchee Edge treats Gemma 4 as the clinical language engine for the whole encounter, not just a chatbot bolted onto the end. Gemma 4 bridges raw speech and structured documentation in one local loop.

Gemma 4 returns strict JSON with:

- a transcript for the spoken segment
- field updates for the clinical intake sheet

The live UI updates demographics, chief complaint, symptoms, vitals, history, allergies, medications, procedures, clinician-stated diagnoses, Gemma 4 documentation insights, and social/claim-readiness fields such as ration card type, income, occupation, caste category, housing type, and location.

After clinician review, the encounter is committed to encrypted PostgreSQL storage. Background tasks generate a Gemma 4 summary and run offline ICD-10-CM / ICD-10-PCS coding so the Diagnostics and Billing Center can show auto-coded claims for review. The same structured record can also be exported as an MVP FHIR R4 Bundle, giving the demo a standards-aligned interoperability path.

## How We Used Gemma 4

Gemma 4 is used in three concrete parts of the system, and each use depends on a different strength of the model.

First, Gemma 4 performs audio-native clinical extraction. We do not use a separate ASR model. This is a major advantage: the system does not have to transcribe with one model and then ask a second model to interpret the transcript. Each speech window is passed directly to Gemma 4 with the current compact patient state. Gemma 4 is strong at following precise instructions, so we ask it to preserve code-switching in the transcript while also extracting normalized clinical fields. It handles the kind of messy speech that appears in real consultations: pauses, repeated phrases, colloquial symptoms, partial information, and doctor-patient turn taking. The backend still validates every field against the application schema before updating the UI.

Second, Gemma 4 generates post-visit consultation summaries from the saved transcript history. This uses its long-form clinical organization ability rather than its audio modality. The summaries focus on facts a doctor actually needs later: symptoms, vitals, medications, procedures, follow-up points, and welfare or claim-readiness details.

Third, Gemma 4 drafts clinician-reviewable clinical notes from structured encounter data through the `/api/generate-note` endpoint. This shows another useful property of Gemma 4: it can turn structured data into polished documentation without inventing missing facts when prompted carefully. A deterministic fallback note exists, but the primary path uses the same local llama.cpp chat endpoint.

Gemma 4 is especially well matched to this project because the task is not just transcription. A useful rural scribe must hear speech, preserve meaning across code-switching, identify which facts are clinically relevant, avoid filling in missing details, and emit a format software can trust. Gemma 4 gives us that combination of multimodal input, instruction following, and local deployability.

We chose Gemma 4 E2B because it gives the hackathon demo the right balance: audio capability, disciplined output, compact deployment, and enough reasoning over clinical context to be useful on edge hardware. We run it in GGUF form with a multimodal projector. Local Windows development can launch `llama-server.exe` from the backend, while Docker Compose runs the official CUDA image `ghcr.io/ggml-org/llama.cpp:server-cuda`. A `gemma-models` init service downloads the model and mmproj into a persistent Docker volume before the llama.cpp server starts.

## Architecture

The application has four main layers.

The frontend is a Next.js app. It records audio, displays the live clinical sheet, persists draft session state, and exposes patient, claims, and diagnostics views.

The FastAPI backend owns the WebSocket session, VAD, schema validation, encrypted persistence, billing automation, FHIR export, and API endpoints. It sends simple WebSocket messages to the UI: `content` events for transcript/status text and `update` events for structured form patches.

The local inference layer is llama.cpp. Gemma 4 works well here because the task rewards compact, disciplined responses more than free-form conversation. We use a no-thinking Gemma 4 chat template, `--reasoning off`, `--reasoning-budget 0`, `--ctx-size 2048`, four inference threads by default, and GPU offload with `--n-gpu-layers 999` when CUDA is available. This keeps responses focused and latency reasonable on edge hardware. It also makes the repository easy to validate: the Gemma 4 model, projector, prompt, template, and server command are all visible.

The coding layer is deliberately separate from the generative model. ICD-10-CM and ICD-10-PCS suggestions use local exact matching, word TF-IDF, character n-gram TF-IDF, and ChromaDB semantic search with a local sentence-transformer. This makes code search explainable, fast, and offline after setup, while Gemma 4 remains focused on the human-language parts of the workflow.

## Engineering Challenges

The biggest challenge was replacing a cloud-style realtime prototype with a real local pipeline. Fixed 20-second audio buffers were too slow and wasted inference on silence, so we moved to adaptive VAD. Speech starts after sustained RMS activity, ends after a silence tail, and force-flushes after a maximum utterance length. Empty or malformed model responses are treated as no-op chunks instead of crashing the session.

Gemma 4's llama.cpp integration also required practical work. Some templates enable thinking tokens by default, which is not appropriate for structured clinical extraction. We added a custom no-thinking Jinja template, explicit reasoning-off flags, and a parser that strips accidental `<think>` blocks before JSON parsing. Once configured this way, Gemma 4 became a dependable structured extraction engine: it can listen, infer the intended field, and keep its output machine-readable.

Prompt design mattered. We found Gemma 4 performs best when the task is framed as documentation support with a small current patient state, an explicit supported-field list, and a strict return shape. That lets the model use its contextual understanding without letting it wander into unsupported clinical advice.

Docker needed its own path. A Python backend container cannot run a Windows llama.cpp executable, so Compose now starts llama.cpp as a dedicated CUDA server container and points the backend at `http://llama-server:8080`.

## Why It Matters

Parchee Edge is designed for clinics that cannot rely on constant cloud connectivity. Patient audio stays local. Clinical records are encrypted. The doctor remains in control. Gemma 4 handles the messy front door of care: multilingual speech, pauses, partial information, colloquial descriptions, and the need to produce structured output immediately. The same model then helps with summaries and clinical notes, so the application feels coherent instead of stitched together from many separate AI services.

That coherence is important. Gemma 4 lets us build an edge product where the model is close to the patient, close to the clinician, and close to the data. The result is not a remote oracle; it is a local documentation partner that turns spoken care into usable records.

The proof of work is in the implemented pipeline: browser audio capture, adaptive VAD, Gemma 4 audio understanding via llama.cpp, strict JSON extraction, live UI updates, Gemma 4 summaries and notes, encrypted EHR persistence, Docker CUDA deployment, automatic model download, offline ICD/PCS coding, FHIR R4 JSON export, and a public repository that exposes each part.

## Next Steps

Next we would add a voice-driven code search mode: the clinician speaks "find fever with cough ICD code," Gemma 4 normalizes the spoken query, and the existing local embedding search returns candidate codes. We would also expand claim-readiness checks for PM-JAY and state schemes, add latency/field-accuracy benchmarks, and evaluate with consented multilingual consultation samples.
