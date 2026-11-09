"""The two models the ai service runs, pinned to exact revisions and loaded once at start-up.

- Cut-outs: BiRefNet (ZhengPeng7/BiRefNet, MIT), a dichotomous segmentation model: a photo in, the
  garment (foreground) as a PNG with a transparent background out.
- Embeddings: Marqo-FashionSigLIP (Marqo/marqo-fashionSigLIP, Apache-2.0) through open_clip: text or an
  image in, a normalised 768-dimension vector out, in one space so text can find images.

Weights are fetched once by app/download.py (at image build time, or by hand locally) into MODELS_DIR
and never fetched per request: at run time Hugging Face is set offline.
"""

from __future__ import annotations

import io
import os
import time
from dataclasses import dataclass
from pathlib import Path

MODELS_DIR = Path(os.environ.get("MODELS_DIR", Path(__file__).resolve().parent.parent / ".models"))

# Exact revisions (commit ids on huggingface.co), checked 2026-11-04. Changing one means re-checking
# its licence and, for BiRefNet, reviewing its remote code again (it runs with trust_remote_code).
CUTOUT_MODELS = {
    # Swin-L backbone: the best edges, and the default.
    "full": {"name": "BiRefNet", "repo": "ZhengPeng7/BiRefNet", "revision": "e2bf8e4460fc8fa32bba5ea4d94b3233d367b0e4", "licence": "MIT"},
    # The same code with the Swin-T backbone (reviewed: only the backbone index differs): smaller and faster, for small machines.
    "lite": {"name": "BiRefNet_lite", "repo": "ZhengPeng7/BiRefNet_lite", "revision": "aa62cd87eafb9cc43056d08ef3615a14628b831d", "licence": "MIT"},
}
CUTOUT = CUTOUT_MODELS[os.environ.get("CUTOUT_MODEL", "full")]
EMBED = {"name": "Marqo-FashionSigLIP", "repo": "Marqo/marqo-fashionSigLIP", "revision": "c56244cc94f92419e8369fa71efdaf403b124ce8", "licence": "Apache-2.0"}
EMBED_DIM = 768
CUTOUT_SIZE = 1024
MAX_SIDE = 2048


def local_dir(model: dict) -> Path:
    return MODELS_DIR / model["repo"].replace("/", "--") / model["revision"]


@dataclass
class Cutout:
    png: bytes
    width: int
    height: int
    ms: int


class Models:
    """Both models, loaded once. Methods are synchronous and CPU-bound: call them off the event loop."""

    def __init__(self) -> None:
        os.environ.setdefault("HF_HUB_OFFLINE", "1")
        os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
        import open_clip
        import torch
        from torchvision import transforms
        from transformers import AutoModelForImageSegmentation

        threads = int(os.environ.get("TORCH_THREADS", "0"))
        if threads > 0:
            torch.set_num_threads(threads)
        self.torch = torch
        started = time.perf_counter()

        self.segmenter = AutoModelForImageSegmentation.from_pretrained(str(local_dir(CUTOUT)), trust_remote_code=True)
        self.segmenter.eval().float()
        self.segment_input = transforms.Compose(
            [
                transforms.Resize((CUTOUT_SIZE, CUTOUT_SIZE)),
                transforms.ToTensor(),
                transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
            ]
        )

        self.clip, _, self.clip_input = open_clip.create_model_and_transforms(f"local-dir:{local_dir(EMBED)}")
        self.clip.eval()
        self.tokenizer = open_clip.get_tokenizer(f"local-dir:{local_dir(EMBED)}")
        self.load_ms = int((time.perf_counter() - started) * 1000)

    def describe(self) -> list[dict]:
        return [
            {**CUTOUT, "task": "cutout", "input": f"{CUTOUT_SIZE}x{CUTOUT_SIZE}"},
            {**EMBED, "task": "embed", "dim": EMBED_DIM},
        ]

    def cutout(self, data: bytes) -> Cutout:
        from PIL import Image

        started = time.perf_counter()
        image = open_image(data)
        with self.torch.inference_mode():
            mask = self.segmenter(self.segment_input(image).unsqueeze(0))[-1].sigmoid()[0, 0]
        alpha = Image.fromarray((mask.numpy() * 255).astype("uint8")).resize(image.size, Image.BILINEAR)
        out = image.copy()
        out.putalpha(alpha)
        # Trimmed to the garment, with a little room, so cut-outs line up when placed together.
        box = alpha.point(lambda a: 255 if a > 16 else 0).getbbox()
        if box:
            pad = max(4, int(0.02 * max(image.size)))
            box = (max(0, box[0] - pad), max(0, box[1] - pad), min(image.width, box[2] + pad), min(image.height, box[3] + pad))
            out = out.crop(box)
        buf = io.BytesIO()
        out.save(buf, "PNG", optimize=True)
        return Cutout(buf.getvalue(), out.width, out.height, int((time.perf_counter() - started) * 1000))

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        with self.torch.inference_mode():
            vectors = self.clip.encode_text(self.tokenizer(texts), normalize=True)
        return vectors.float().tolist()

    def embed_images(self, images: list[bytes]) -> list[list[float]]:
        batch = self.torch.stack([self.clip_input(on_white(open_image(data, keep_alpha=True))) for data in images])
        with self.torch.inference_mode():
            vectors = self.clip.encode_image(batch, normalize=True)
        return vectors.float().tolist()


class BadImage(ValueError):
    """The bytes aren't an image the service can read."""


def open_image(data: bytes, keep_alpha: bool = False):
    from PIL import Image, ImageOps, UnidentifiedImageError

    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except (UnidentifiedImageError, OSError) as e:
        raise BadImage("not a readable image") from e
    image = ImageOps.exif_transpose(image)
    if max(image.size) > MAX_SIDE:
        image.thumbnail((MAX_SIDE, MAX_SIDE))
    if keep_alpha and image.mode in ("RGBA", "LA", "P"):
        return image.convert("RGBA")
    return image.convert("RGB")


def on_white(image):
    """A cut-out (transparent background) on white, as product photos are, before embedding."""
    from PIL import Image

    if image.mode != "RGBA":
        return image
    ground = Image.new("RGB", image.size, (255, 255, 255))
    ground.paste(image, mask=image.getchannel("A"))
    return ground
