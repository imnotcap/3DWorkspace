# COLMAP (Ubuntu package) + OpenMVS v2.4.0 built from source, CPU-only: runs on any machine.
# Build recipe mirrors OpenMVS's own docker/buildInDocker.sh for v2.4.0.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential git cmake ca-certificates \
      libpng-dev libjpeg-dev libtiff-dev libglu1-mesa-dev libglew-dev libglfw3-dev \
      libboost-iostreams-dev libboost-program-options-dev libboost-system-dev libboost-serialization-dev libboost-thread-dev \
      libopencv-dev libgmp-dev libmpfr-dev zlib1g-dev libeigen3-dev python3-dev \
      colmap python3-venv \
 && rm -rf /var/lib/apt/lists/*

# CGAL (header-only) and VCG, versions as in OpenMVS v2.4.0's build script
RUN git clone --depth 1 --branch v6.0.1 https://github.com/cgal/cgal /src/cgal \
 && cmake -S /src/cgal -B /src/cgal/build && cmake --install /src/cgal/build && rm -rf /src/cgal
RUN git clone --depth 1 https://github.com/cdcseacave/VCG.git /vcglib

RUN git clone --depth 1 --branch v2.4.0 https://github.com/cdcseacave/openMVS.git /src/openMVS \
 && cmake -S /src/openMVS -B /src/openMVS/build -DCMAKE_BUILD_TYPE=Release -DVCG_ROOT=/vcglib -DOpenMVS_USE_CUDA=OFF \
 && cmake --build /src/openMVS/build -j"$(nproc)" && cmake --install /src/openMVS/build \
 && rm -rf /src/openMVS
ENV PATH=/usr/local/bin/OpenMVS:$PATH

RUN python3 -m venv /venv && /venv/bin/pip install --no-cache-dir \
      fastapi==0.115.6 "uvicorn[standard]==0.34.0" python-multipart==0.0.20 \
      numpy==2.2.1 trimesh==4.5.3 scipy==1.15.0 networkx==3.4.2 pillow==11.1.0

WORKDIR /app
COPY app.py .
ENV WORK_DIR=/work
EXPOSE 8001
CMD ["/venv/bin/uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8001"]
