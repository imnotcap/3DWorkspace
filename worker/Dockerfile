FROM pytorch/pytorch:2.5.1-cuda12.4-cudnn9-devel

ENV DEBIAN_FRONTEND=noninteractive PIP_NO_CACHE_DIR=1 HF_HOME=/models
RUN apt-get update && apt-get install -y --no-install-recommends git libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*

# Tencent's open-source inference package (shape generation + rembg + mesh cleanup).
RUN git clone --depth 1 https://github.com/Tencent/Hunyuan3D-2 /opt/hy3d \
 && pip install -r /opt/hy3d/requirements.txt \
 && pip install -e /opt/hy3d \
 && pip install fastapi==0.115.6 "uvicorn[standard]==0.34.0" python-multipart==0.0.20

# Texture painter's CUDA extensions (needed when TEXTURE=1).
ENV TORCH_CUDA_ARCH_LIST="7.5;8.0;8.6;8.9;9.0"
RUN cd /opt/hy3d/hy3dgen/texgen/custom_rasterizer && python setup.py install \
 && cd /opt/hy3d/hy3dgen/texgen/differentiable_renderer && python setup.py install

WORKDIR /app
COPY app.py .
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
