# -*- coding: utf-8 -*-
import asyncio
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import make_tts
import process_work_upload


class WorkPipelineTests(unittest.TestCase):
    def test_raw_content_keeps_blank_line_paragraphs(self):
        content = ('2026년 성령 사연 162\n\n첫 줄&#x20;\n둘째 줄\n\n마지막')
        self.assertEqual(
            process_work_upload.paragraphs_from_content(content, 162),
            [['첫 줄', '둘째 줄'], ['마지막']])

    def test_tts_returns_sentence_boundaries(self):
        async def run():
            handle, path = tempfile.mkstemp(suffix='.mp3')
            os.close(handle)
            try:
                boundaries = await make_tts.synthesize(
                    '시험 제목.\n\n첫 문단입니다.\n\n둘째 문단입니다.', path)
                self.assertGreater(os.path.getsize(path), 0)
                self.assertGreaterEqual(len(boundaries), 3)
            finally:
                os.remove(path)

        asyncio.run(run())


if __name__ == '__main__':
    unittest.main()
