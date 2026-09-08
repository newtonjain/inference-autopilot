FROM python:3.13-slim
WORKDIR /app
COPY collector.py /app/collector.py
USER 65532:65532
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
EXPOSE 8080
CMD ["python", "/app/collector.py"]
