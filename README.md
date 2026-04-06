# PhyloSpark — Plataforma de Análisis Filogenético con Big Data

> Workbench reproducible para recuperación, alineamiento, análisis filogenético y reporte de secuencias biológicas.

## Visión

Transformar el flujo manual de análisis filogenético (buscar → descargar → alinear → árbol → interpretar) en un **pipeline automatizado, reproducible y escalable** orquestado con Airflow y potenciado con Apache Spark.

## Caso de uso base

Análisis de **α-amilasas GH13** — secuencias proteicas de interés en biotecnología e industria.  
El sistema permite pasar de 10 secuencias manuales a **cientos o miles** con trazabilidad completa.

---

## Arquitectura

```
┌──────────────────────────────────────────────────────────────────────┐
│                         PhyloSpark Platform                          │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────────────────┐  │
│  │   React UI   │───▶│   FastAPI    │───▶│   PostgreSQL          │  │
│  │  phylo.auto  │    │  api.phylo   │    │  metadata + jobs      │  │
│  │  mation.com  │    │  .automation │    │                       │  │
│  │  .mx         │    │  .com.mx     │    │                       │  │
│  └──────────────┘    └──────────────┘    └───────────────────────┘  │
│         │                    │                                       │
│         │                    ▼                                       │
│         │            ┌──────────────┐    ┌───────────────────────┐  │
│         │            │   Airflow    │───▶│   MinIO (S3)          │  │
│         │            │  airflow.    │    │  minio.phylo          │  │
│         │            │  phylo...    │    │  .automation.com.mx   │  │
│         │            └──────────────┘    └───────────────────────┘  │
│         │                    │                                       │
│         │          ┌─────────┴──────────┐                           │
│         │          ▼                    ▼                           │
│         │   ┌─────────────┐    ┌────────────────┐                  │
│         │   │ Apache Spark│    │  Bio Tools     │                  │
│         │   │ ETL + k-mer │    │  MAFFT/MUSCLE  │                  │
│         │   │ + features  │    │  FastTree       │                  │
│         │   │ + clustering│    │  Biopython      │                  │
│         │   └─────────────┘    └────────────────┘                  │
│         │                                                           │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              Infrastructure (AWS + Terraform)                 │   │
│  │  EC2 instance · S3 bucket · VPC · Security Groups             │   │
│  │  Docker Compose (dev) → K8s/EKS (future)                     │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Servicios

| Servicio | Tech | Subdominio | Puerto local |
|----------|------|------------|-------------|
| Frontend | React + Vite + Tailwind | phylo.automation.com.mx | 3000 |
| API | FastAPI + Python 3.11 | api.phylo.automation.com.mx | 8000 |
| Airflow | Apache Airflow 2.x | airflow.phylo.automation.com.mx | 8080 |
| MinIO | S3-compatible storage | minio.phylo.automation.com.mx | 9000/9001 |
| Spark | PySpark local/cluster | (internal) | 4040 |
| Postgres | PostgreSQL 16 | (internal) | 5432 |

---

## Flujo del Pipeline (DAG de Airflow)

```
[Pamela: formulario web]
        │
        ▼
   create_experiment          ← FastAPI registra job en Postgres
        │
        ▼
   download_sequences         ← NCBI Entrez API → MinIO raw/
        │
        ▼
   validate_fasta             ← Biopython QC → MinIO clean/
        │
        ▼
   spark_feature_engineering  ← PySpark: longitud, composición, k-mers
        │                       features → MinIO features/
        ▼
   spark_similarity_matrix    ← PySpark: distancias preliminares
        │                       matrix → MinIO analysis/
        ▼
   run_alignment              ← MAFFT/MUSCLE → MinIO alignments/
        │
        ▼
   trim_alignment             ← trimAl/Biopython → MinIO alignments/
        │
        ▼
   build_tree                 ← FastTree/IQ-TREE → MinIO trees/
        │
        ▼
   annotate_results           ← Biopython + Spark → clados, divergencias
        │
        ▼
   generate_report            ← Jinja2 → HTML/PDF en MinIO reports/
        │
        ▼
   notify_complete            ← API actualiza job → UI muestra resultado
```

---

## Estructura del proyecto

```
dev/
├── README.md                    ← Este archivo
├── docker-compose.yml           ← Stack completo para desarrollo local
├── .env.example                 ← Variables de entorno (template)
├── .gitignore
│
├── terraform/                   ← IaC para AWS
│   ├── main.tf
│   ├── variables.tf
│   ├── outputs.tf
│   ├── terraform.tfvars         ← Creds (git-ignored)
│   └── modules/
│       ├── networking/
│       ├── compute/
│       └── storage/
│
├── frontend/                    ← React + Vite
│   ├── package.json
│   ├── Dockerfile
│   └── src/
│
├── api/                         ← FastAPI
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── main.py
│   └── app/
│       ├── routers/
│       ├── services/
│       ├── models/
│       └── config.py
│
├── airflow/                     ← Airflow DAGs + plugins
│   ├── Dockerfile
│   ├── dags/
│   │   └── phylo_pipeline.py
│   ├── plugins/
│   │   └── operators/
│   │       ├── ncbi_operator.py
│   │       ├── spark_operator.py
│   │       └── bio_operator.py
│   └── config/
│
├── spark/                       ← PySpark jobs
│   ├── requirements.txt
│   ├── jobs/
│   │   ├── feature_engineering.py
│   │   ├── similarity_matrix.py
│   │   └── clustering.py
│   └── tests/
│
├── bio/                         ← Bioinformatics tools
│   ├── requirements.txt
│   ├── tools/
│   │   ├── ncbi_fetch.py
│   │   ├── alignment.py
│   │   ├── tree_builder.py
│   │   └── report_generator.py
│   └── tests/
│
├── nginx/                       ← Reverse proxy config
│   └── nginx.conf
│
├── scripts/                     ← Utility scripts
│   ├── check_aws.py
│   ├── setup_local.sh
│   └── deploy.sh
│
├── docs/                        ← Documentation
│   ├── ARCHITECTURE.md
│   ├── SETUP.md
│   └── PIPELINE.md
│
└── .github/                     ← CI/CD
    └── workflows/
        ├── api.yml
        └── frontend.yml
```

---

## Quick Start (Local)

```bash
# 1. Clonar y configurar
cp .env.example .env
# Editar .env con credenciales

# 2. Levantar servicios
docker compose up -d

# 3. Acceder
# Frontend:  http://localhost:3000
# API:       http://localhost:8000/docs
# Airflow:   http://localhost:8080
# MinIO:     http://localhost:9001
# Spark UI:  http://localhost:4040
```

## Deploy AWS (Terraform)

```bash
cd terraform
terraform init
terraform plan
terraform apply    # Levanta infra
# ... usar plataforma ...
terraform destroy  # Apaga todo (ahorro de costos)
```

## Deploy Productivo Recomendado

Para este repositorio, la ruta correcta es:

- GitHub para código y disparo de pipelines
- Docker Hub para almacenar imágenes versionadas
- AWS EC2 como runtime inicial
- Docker Compose para orquestar el stack
- Caddy para TLS automático y subdominios

Esto ya está preparado con:

- [docker-compose.prod.yml](c:\Users\andre\OneDrive\Documents\DEV\MAESTRIA\Segundo Cuatrimestre\BigData\ACTIVIDAD-08\dev\docker-compose.prod.yml)
- [Caddyfile](c:\Users\andre\OneDrive\Documents\DEV\MAESTRIA\Segundo Cuatrimestre\BigData\ACTIVIDAD-08\dev\Caddyfile)
- [frontend/Dockerfile.prod](c:\Users\andre\OneDrive\Documents\DEV\MAESTRIA\Segundo Cuatrimestre\BigData\ACTIVIDAD-08\dev\frontend\Dockerfile.prod)
- [airflow/Dockerfile.prod](c:\Users\andre\OneDrive\Documents\DEV\MAESTRIA\Segundo Cuatrimestre\BigData\ACTIVIDAD-08\dev\airflow\Dockerfile.prod)
- [.github/workflows/deploy-aws.yml](c:\Users\andre\OneDrive\Documents\DEV\MAESTRIA\Segundo Cuatrimestre\BigData\ACTIVIDAD-08\dev\.github\workflows\deploy-aws.yml)
- [docs/AWS-DEPLOYMENT.md](c:\Users\andre\OneDrive\Documents\DEV\MAESTRIA\Segundo Cuatrimestre\BigData\ACTIVIDAD-08\dev\docs\AWS-DEPLOYMENT.md)

Flujo final:

1. `git push` a `main`
2. GitHub Actions construye y publica imágenes en Docker Hub
3. GitHub Actions entra a EC2 por SSH
4. EC2 hace `docker compose pull` y `docker compose up -d`
5. Caddy publica:
     - `https://phylo.<dominio>`
     - `https://api.phylo.<dominio>`
     - `https://airflow.phylo.<dominio>`
     - `https://minio.phylo.<dominio>`

---

## Equivalencias Hadoop → Arquitectura Moderna

| Hadoop clásico | PhyloSpark equivalente | Justificación |
|---------------|----------------------|---------------|
| HDFS | MinIO (S3-compatible) | Object storage distribuido, API S3 estándar |
| YARN | Docker / K8s (futuro) | Gestión de recursos y scheduling |
| MapReduce | Apache Spark | Motor analítico unificado |
| Hive | Spark SQL | Consultas SQL sobre datos distribuidos |
| Oozie | Apache Airflow | Orquestación de workflows |
| Ambari | Terraform + Docker Compose | Provisioning y gestión |

---

## Roadmap

### v0.1 — MVP Local (actual)
- [ ] Docker Compose funcional
- [ ] API con endpoints básicos
- [ ] DAG de Airflow con pipeline completo
- [ ] Spark jobs para features
- [ ] MinIO como data lake
- [ ] Frontend con formulario y resultados

### v0.2 — AWS Deploy
- [ ] Terraform para EC2 + S3
- [ ] Deploy automatizado
- [ ] Subdominios configurados
- [ ] GitHub Actions CI/CD

### v0.3 — Scale
- [ ] Soporte para 1000+ secuencias
- [ ] Spark cluster mode
- [ ] Monitoring y alertas
- [ ] Modelo ML para clasificación

---

## Autores

- **Andrés Bardales** — Arquitectura, DevOps, Big Data, Infraestructura
- **Pamela Bardales** — Dominio científico, Bioinformática, Validación biológica
