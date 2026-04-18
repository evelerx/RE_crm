FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY app /app/app
COPY alembic /app/alembic
COPY alembic.ini /app/alembic.ini

# Create data directory for SQLite and set permissions before switching user
RUN mkdir -p /data

# Run as non-root user for security
RUN useradd -m -u 1001 appuser && chown -R appuser:appuser /app /data
USER appuser

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
