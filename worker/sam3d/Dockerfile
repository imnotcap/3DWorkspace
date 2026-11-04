# SAM 3D server for 3D Workspace: Meta SAM 3 (segmentation) + SAM 3D Objects (3D), one image.
#
# The two models need different environments (SAM 3: Python 3.12 / PyTorch 2.10 cu128;
# SAM 3D Objects: Python 3.11 / PyTorch 2.5.1 cu121), so each gets its own micromamba env,
# installed exactly as its README says. They run as two processes; only app.py is exposed.
#
# Needs an NVIDIA GPU with 32 GB+ VRAM (Meta's requirement for SAM 3D Objects) and a driver
# new enough for CUDA 12.8. Weights are gated: see README.md for HF_TOKEN.

FROM nvidia/cuda:12.8.1-cudnn-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    MAMBA_ROOT_PREFIX=/opt/conda \
    PIP_NO_CACHE_DIR=1 \
    # Compile CUDA extensions (pytorch3d, gsplat, …) for these GPUs; there is no GPU at build time.
    TORCH_CUDA_ARCH_LIST="8.0;8.6;8.9;9.0" \
    FORCE_CUDA=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      git curl ca-certificates bzip2 build-essential libgl1 libglib2.0-0 libegl1 libgomp1 \
 && rm -rf /var/lib/apt/lists/* \
 && curl -Ls https://micro.mamba.pm/api/micromamba/linux-64/latest | tar -xj -C /usr/local bin/micromamba

# ───── SAM 3D Objects (github.com/facebookresearch/sam-3d-objects, doc/setup.md) ─────
RUN git clone https://github.com/facebookresearch/sam-3d-objects /opt/sam-3d-objects
WORKDIR /opt/sam-3d-objects
RUN micromamba env create -y -n sam3d -f environments/default.yml && micromamba clean -a -y
SHELL ["micromamba", "run", "-n", "sam3d", "/bin/bash", "-c"]
RUN export PIP_EXTRA_INDEX_URL="https://pypi.ngc.nvidia.com https://download.pytorch.org/whl/cu121" \
 && pip install -e '.[dev]' \
 && pip install -e '.[p3d]' \
 && export PIP_FIND_LINKS="https://nvidia-kaolin.s3.us-east-2.amazonaws.com/torch-2.5.1_cu121.html" \
 && pip install -e '.[inference]' \
 && ./patching/hydra \
 && pip install scipy 'huggingface-hub[cli]<1.0'

# ───── SAM 3 (github.com/facebookresearch/sam3, README "Installation") ─────
SHELL ["/bin/bash", "-c"]
RUN git clone https://github.com/facebookresearch/sam3 /opt/sam3 \
 && micromamba create -y -n sam3 -c conda-forge python=3.12 && micromamba clean -a -y
SHELL ["micromamba", "run", "-n", "sam3", "/bin/bash", "-c"]
RUN pip install torch==2.10.0 torchvision --index-url https://download.pytorch.org/whl/cu128 \
 && pip install -e /opt/sam3 \
 && pip install scipy pillow

SHELL ["/bin/bash", "-c"]
WORKDIR /app
COPY app.py masks.py pose.py glb.py reconstructor.py segmenter.py mock.py start.sh ./
RUN chmod +x start.sh && mkdir -p /models && chmod 777 /models

# Hugging Face Docker Spaces serve port 7860.
EXPOSE 7860
ENV MODELS_DIR=/models SAM3D_ROOT=/opt/sam-3d-objects
CMD ["./start.sh"]
