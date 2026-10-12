"""Single-worker private MeloTTS API. Run behind HTTPS; never expose port 8000."""
import contextlib
import hmac
import io
import os
import threading
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
lock = threading.Lock()
model = None

class Speech(BaseModel):
    text: str = Field(min_length=1, max_length=1000)

@app.get('/health')
def health():
    return {'ready': model is not None}

@app.post('/speech')
def speech(body: Speech, request: Request):
    token = os.environ.get('MELO_API_TOKEN', '')
    if not token or not hmac.compare_digest(request.headers.get('authorization', ''), 'Bearer ' + token):
        raise HTTPException(401, 'Unauthorized')
    if not lock.acquire(blocking=False):
        raise HTTPException(429, 'Busy', headers={'Retry-After': '3'})
    try:
        import soundfile as sf
        text = body.text.translate(str.maketrans({'<': ' ', '>': ' '}))
        with open(os.devnull, 'w') as sink, contextlib.redirect_stdout(sink):
            wave = model.tts_to_file(text, model.hps.data.spk2id['KR'], speed=1.0, quiet=True)
        output = io.BytesIO()
        sf.write(output, wave, model.hps.data.sampling_rate, format='WAV')
        return Response(output.getvalue(), media_type='audio/wav', headers={'Cache-Control': 'no-store'})
    except Exception:
        raise HTTPException(500, 'Speech generation failed') from None
    finally:
        lock.release()

@app.on_event('startup')
def load_model():
    global model
    if len(os.environ.get('MELO_API_TOKEN', '')) < 32:
        raise RuntimeError('Set a random MELO_API_TOKEN of at least 32 characters')
    import torch
    from melo.api import TTS
    torch.set_num_threads(2)
    model = TTS(language='KR', device='cpu')
