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
- `9999`: Additional service port

### Volumes

- `~/.hindsight-docker` → `/home/hindsight/.pg0`: Persistent storage for Hindsight data

## Usage

### Start Services

```bash
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

1. The container runs with `stdin_open: true` and `tty: true` for interactive sessions
2. Restart policy is set to "no" (do not restart automatically)
3. Image pull policy is "always" to ensure latest version
4. Ensure your DeepSeek API key has sufficient credits for model usage