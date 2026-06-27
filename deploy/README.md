# Hindsight Docker Compose

Docker Compose configuration for running Hindsight with DeepSeek integration.

## Configuration

This setup configures Hindsight to use DeepSeek's reasoning model via OpenAI-compatible API.

### Environment Variables

- `HINDSIGHT_API_LLM_PROVIDER`: openai (OpenAI-compatible API)
- `HINDSIGHT_API_LLM_BASE_URL`: https://api.deepseek.com/v1 (DeepSeek API endpoint)
- `HINDSIGHT_API_LLM_MODEL`: deepseek-reasoner (DeepSeek's reasoning model)
- `HINDSIGHT_API_LLM_API_KEY`: Your DeepSeek API key

### Ports

- `8888`: Hindsight web interface
- `9999`: Additional Hindsight service port exposed by the upstream container

### Volumes

- `~/.hindsight-docker` → `/home/hindsight/.pg0`: Persistent storage for Hindsight data

## Usage

### Start Services

```bash
cp .env.example .env
chmod 600 .env
# Edit .env and set HINDSIGHT_API_LLM_API_KEY before starting.
docker compose up -d
```

### View Logs

```bash
docker compose logs -f
```

### Stop Services

```bash
docker compose down
```

### Stop and Remove Containers

```bash
docker compose down -v
```

## Notes

1. Restart policy is `always`, matching `docker-compose.yml`
2. Image pull policy is `if_not_present`; pull manually when you want to refresh `latest`
3. The compose file mounts local ModelScope model paths under `/data/.cache/modelscope/...`; update those bind mounts if your models live elsewhere
4. The compose file sets DNS servers to `8.8.8.8` and `1.1.1.1`; adjust them if your environment requires internal DNS
5. Ensure your DeepSeek API key has sufficient credits for model usage
