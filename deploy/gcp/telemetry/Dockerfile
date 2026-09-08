FROM python:3.13-slim
WORKDIR /app
COPY export_metrics.py /app/export_metrics.py
USER 65532:65532
ENTRYPOINT ["python", "-B", "/app/export_metrics.py"]
