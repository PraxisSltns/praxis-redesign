"""Fetches both models' files at their pinned revisions into MODELS_DIR. Run once: at image build time
(Dockerfile) or by hand locally (python -m app.download). Nothing is fetched while serving."""

from huggingface_hub import snapshot_download

from app.models import CUTOUT, EMBED, local_dir

# Only what each loader reads: BiRefNet's code, config and safetensors weights; open_clip's config,
# safetensors weights and tokenizer. No pickled (.bin) weights.
FILES = {
    CUTOUT["repo"]: ["config.json", "BiRefNet_config.py", "birefnet.py", "model.safetensors"],  # full or lite, from CUTOUT_MODEL
    EMBED["repo"]: ["open_clip_config.json", "open_clip_model.safetensors", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json"],
}

if __name__ == "__main__":
    for model in (CUTOUT, EMBED):
        target = local_dir(model)
        snapshot_download(repo_id=model["repo"], revision=model["revision"], local_dir=target, allow_patterns=FILES[model["repo"]])
        print(f"{model['name']} {model['revision'][:7]} -> {target}")
