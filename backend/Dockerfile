FROM python:3.11

WORKDIR /app

# Copiar dependencias primero (mejor cache)
COPY requirements.txt .

# Instalar dependencias reales del proyecto
RUN pip install --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copiar todo el backend
COPY . .

# Exponer puerto FastAPI
EXPOSE 8000

# Ejecutar tu servidor real
CMD ["python", "server.py"]
