import json
import unittest
from pathlib import Path
from unittest.mock import AsyncMock
from unittest.mock import patch

from app.services.llama_cpp_gemma_service import (
    LlamaCppConfig,
    LlamaCppGemmaService,
    is_probably_silent,
    parse_extraction_response,
    validate_updates,
)
from app.services.llama_server_manager import LlamaServerConfig, LlamaServerManager


class ExtractionParsingTests(unittest.TestCase):
    def test_parses_plain_json_response(self):
        parsed = parse_extraction_response(
            json.dumps(
                {
                    "transcript": "patient has fever",
                    "updates": [{"field": "chief_complaint", "value": "fever"}],
                }
            )
        )

        self.assertEqual(parsed["transcript"], "patient has fever")
        self.assertEqual(parsed["updates"][0]["field"], "chief_complaint")

    def test_recovers_json_from_wrapped_response(self):
        parsed = parse_extraction_response(
            'Here is the JSON:\n{"transcript":"hi","updates":[]}\nDone'
        )

        self.assertEqual(parsed["transcript"], "hi")

    def test_empty_response_returns_no_extraction(self):
        self.assertEqual(parse_extraction_response(""), {"transcript": "", "updates": []})

    def test_non_json_response_returns_no_extraction(self):
        self.assertEqual(parse_extraction_response("not json"), {"transcript": "", "updates": []})

    def test_strips_thinking_blocks_before_parsing(self):
        parsed = parse_extraction_response(
            '<think>private scratchpad</think>{"transcript":"ok","updates":[]}'
        )

        self.assertEqual(parsed["transcript"], "ok")


class UpdateValidationTests(unittest.TestCase):
    def test_validates_scalar_and_nested_vitals(self):
        updates = validate_updates(
            [
                {"field": "name", "value": "Asha"},
                {"field": "vitals.spo2", "value": "96"},
                {"field": "unsupported", "value": "ignored"},
            ]
        )

        self.assertEqual(
            updates,
            [
                {"field": "name", "value": "Asha"},
                {"field": "vitals.spo2", "value": "96"},
            ],
        )

    def test_splits_list_field_string(self):
        updates = validate_updates(
            [{"field": "symptoms", "value": "fever, cough, fatigue"}]
        )

        self.assertEqual(updates[0]["value"], ["fever", "cough", "fatigue"])

    def test_merges_duplicate_list_values(self):
        service = LlamaCppGemmaService(LlamaCppConfig(mode="cli"))
        service.patient_state["symptoms"] = ["fever"]

        merged = service._merge_update("symptoms", ["Fever", "cough"])

        self.assertEqual(merged, ["fever", "cough"])

    def test_overwrites_scalar_values(self):
        service = LlamaCppGemmaService(LlamaCppConfig(mode="cli"))
        service._merge_update("age", "42")

        self.assertEqual(service._merge_update("age", "43"), "43")

    def test_silent_pcm_is_filtered(self):
        self.assertTrue(is_probably_silent(b"\x00" * 320000, 180))

    def test_loud_pcm_is_not_filtered(self):
        self.assertFalse(is_probably_silent((1000).to_bytes(2, "little", signed=True) * 16000, 180))


class AdapterModeTests(unittest.TestCase):
    def test_server_mode_is_respected(self):
        service = LlamaCppGemmaService(LlamaCppConfig(mode="server"))

        self.assertEqual(service.config.mode, "server")

    def test_auto_mode_can_select_server_when_probe_succeeds(self):
        service = LlamaCppGemmaService(LlamaCppConfig(mode="auto"))
        service._server_supports_audio = lambda: True

        self.assertTrue(service._server_supports_audio())

    def test_auto_mode_can_select_cli_when_probe_fails(self):
        service = LlamaCppGemmaService(LlamaCppConfig(mode="auto"))
        service._server_supports_audio = lambda: False

        self.assertFalse(service._server_supports_audio())


class VadSegmentationTests(unittest.IsolatedAsyncioTestCase):
    async def test_vad_processes_after_speech_then_silence(self):
        service = LlamaCppGemmaService(
            LlamaCppConfig(
                mode="server",
                min_rms=180,
                vad_frame_ms=250,
                vad_start_ms=250,
                vad_end_silence_ms=500,
                min_speech_ms=250,
            )
        )
        service._process_chunk = AsyncMock()
        websocket = object()
        loud_frame = (1000).to_bytes(2, "little", signed=True) * 4000
        silent_frame = b"\x00" * 8000

        await service._handle_vad_frame(websocket, loud_frame)
        await service._handle_vad_frame(websocket, loud_frame)
        await service._handle_vad_frame(websocket, silent_frame)
        await service._handle_vad_frame(websocket, silent_frame)

        service._process_chunk.assert_awaited_once()

    async def test_vad_ignores_pure_silence(self):
        service = LlamaCppGemmaService(LlamaCppConfig(mode="server"))
        service._process_chunk = AsyncMock()
        websocket = object()
        silent_frame = b"\x00" * 8000

        await service._handle_vad_frame(websocket, silent_frame)
        await service._handle_vad_frame(websocket, silent_frame)

        service._process_chunk.assert_not_awaited()


class LlamaServerManagerTests(unittest.TestCase):
    def test_builds_backend_managed_server_command(self):
        config = LlamaServerConfig(
            binary_path=Path("C:/llama/llama-server.exe"),
            model_path=Path("C:/models/gemma.gguf"),
            mmproj_path=Path("C:/models/mmproj.gguf"),
            chat_template_path=Path("C:/templates/no_think.jinja"),
            ctx_size=2048,
            threads=4,
            host="127.0.0.1",
            port=8080,
        )
        command = LlamaServerManager(config)._build_command()

        self.assertIn("--ctx-size", command)
        self.assertIn("2048", command)
        self.assertIn("--reasoning", command)
        self.assertIn("off", command)
        self.assertIn("--chat-template-file", command)

    def test_downloads_missing_model_files(self):
        class FakeResponse:
            headers = {"Content-Length": "5"}

            def __enter__(self):
                self.chunks = [b"model", b""]
                return self

            def __exit__(self, *args):
                return False

            def read(self, _size):
                return self.chunks.pop(0)

        test_dir = Path(__file__).parent
        model_path = test_dir / "_tmp_model.gguf"
        mmproj_path = test_dir / "_tmp_mmproj.gguf"
        model_path.unlink(missing_ok=True)
        mmproj_path.unlink(missing_ok=True)
        try:
            config = LlamaServerConfig(
                model_path=model_path,
                mmproj_path=mmproj_path,
                model_url="https://example.test/model",
                mmproj_url="https://example.test/mmproj",
                download_models=True,
            )

            with patch("urllib.request.urlopen", return_value=FakeResponse()):
                LlamaServerManager(config)._ensure_model_files()

            self.assertEqual(model_path.read_bytes(), b"model")
            self.assertEqual(mmproj_path.read_bytes(), b"model")
        finally:
            model_path.unlink(missing_ok=True)
            mmproj_path.unlink(missing_ok=True)

    def test_spawn_env_prepends_llama_bin_to_path(self):
        config = LlamaServerConfig(binary_path=Path("C:/llama/bin/llama-server.exe"))
        env = LlamaServerManager(config)._build_env()

        self.assertTrue(env["PATH"].startswith("C:\\llama\\bin"))
        self.assertEqual(env["CUDA_MODULE_LOADING"], "LAZY")


if __name__ == "__main__":
    unittest.main()
