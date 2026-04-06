# AWS Deployment Flow

## Recommendation

For this repository, use:

- GitHub as source of truth
- GitHub Actions for CI/CD
- Docker Hub as the image registry
- EC2 + Docker Compose as the runtime
- Caddy as the edge proxy for HTTPS and subdomains

Do not use ArgoCD here yet.

ArgoCD adds value when the runtime is Kubernetes and the desired state lives in manifests. This project is still a Docker Compose stack on a single host, so ArgoCD would only add operational weight without solving a real problem.

## Target Flow

1. Push changes to `main`
2. GitHub Actions builds `api`, `frontend`, and `airflow`
3. Images are pushed to Docker Hub
4. GitHub Actions connects to the EC2 host by SSH
5. The workflow updates `/opt/phylospark/.env`
6. The server runs `docker compose pull` and `docker compose up -d`
7. Caddy serves:
   - `https://phylo.<domain>`
   - `https://api.phylo.<domain>`
   - `https://airflow.phylo.<domain>`
   - `https://minio.phylo.<domain>`

## One-Time AWS Setup

1. Create or reuse an EC2 instance with Ubuntu 22.04.
2. Attach the Elastic IP.
3. Open inbound ports `80` and `443` publicly.
4. Restrict `22` to your IP.
5. Run [scripts/bootstrap-ec2.sh](../scripts/bootstrap-ec2.sh) on the instance.
6. Create `/opt/phylospark`.

## DNS Records

Create `A` records pointing to the EC2 Elastic IP:

- `phylo.<domain>`
- `api.phylo.<domain>`
- `airflow.phylo.<domain>`
- `minio.phylo.<domain>`
- `s3.phylo.<domain>`

If your DNS is not in Route 53, that is fine. Caddy only needs the records to resolve publicly.

## Required GitHub Secrets

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`
- `EC2_HOST`
- `EC2_USER`
- `EC2_SSH_KEY`
- `PROD_ENV_FILE`

`PROD_ENV_FILE` should contain the full content of [.env.production.example](../.env.production.example) with real values.

## Production Files Added

- [docker-compose.prod.yml](../docker-compose.prod.yml)
- [Caddyfile](../Caddyfile)
- [frontend/Dockerfile.prod](../frontend/Dockerfile.prod)
- [airflow/Dockerfile.prod](../airflow/Dockerfile.prod)
- [scripts/bootstrap-ec2.sh](../scripts/bootstrap-ec2.sh)
- [.github/workflows/deploy-aws.yml](../.github/workflows/deploy-aws.yml)

## Operational Notes

- The frontend stays behind the same host and uses `/api` and `/ws`, so browser traffic does not need cross-origin configuration for normal usage.
- API, Airflow, and MinIO remain private behind the reverse proxy and are not exposed as raw container ports.
- Docker Hub keeps the workflow aligned with your existing Software Factory practices.
- If later you move to ECS or EKS, the next migration target should be ECR instead of Docker Hub.

## Manual Deploy Fallback

If GitHub Actions is unavailable, you can deploy directly on the server:

```bash
cd /opt/phylospark
docker login
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d --remove-orphans
```