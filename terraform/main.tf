terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region     = var.aws_region
  access_key = var.aws_access_key
  secret_key = var.aws_secret_key
}

# ─── Data Sources (existing resources) ──────────────────
data "aws_vpc" "bigdata" {
  filter {
    name   = "tag:Name"
    values = ["bigdata-lab-vpc"]
  }
}

data "aws_subnets" "bigdata" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.bigdata.id]
  }
}

data "aws_eip" "main" {
  public_ip = var.elastic_ip
}

data "aws_security_group" "bigdata" {
  filter {
    name   = "group-name"
    values = ["bigdata-lab"]
  }
  vpc_id = data.aws_vpc.bigdata.id
}

# ─── S3 Bucket for data persistence ────────────────────
resource "aws_s3_bucket" "phylospark" {
  bucket = "phylospark-data-${var.aws_region}"

  tags = {
    Project     = "PhyloSpark"
    Environment = "dev"
    ManagedBy   = "terraform"
  }
}

resource "aws_s3_bucket_versioning" "phylospark" {
  bucket = aws_s3_bucket.phylospark.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "phylospark" {
  bucket                  = aws_s3_bucket.phylospark.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ─── Security Group Rules ──────────────────────────────
resource "aws_security_group_rule" "http" {
  type              = "ingress"
  from_port         = 80
  to_port           = 80
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = data.aws_security_group.bigdata.id
  description       = "HTTP - Nginx reverse proxy"
}

resource "aws_security_group_rule" "https" {
  type              = "ingress"
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  cidr_blocks       = ["0.0.0.0/0"]
  security_group_id = data.aws_security_group.bigdata.id
  description       = "HTTPS"
}

resource "aws_security_group_rule" "ssh" {
  type              = "ingress"
  from_port         = 22
  to_port           = 22
  protocol          = "tcp"
  cidr_blocks       = [var.my_ip]
  security_group_id = data.aws_security_group.bigdata.id
  description       = "SSH access"
}

# ─── EC2 Instance ──────────────────────────────────────
resource "aws_instance" "phylospark" {
  ami                    = var.ami_id
  instance_type          = var.instance_type
  key_name               = var.key_pair_name
  subnet_id              = tolist(data.aws_subnets.bigdata.ids)[0]
  vpc_security_group_ids = [data.aws_security_group.bigdata.id]

  root_block_device {
    volume_size = 30
    volume_type = "gp3"
  }

  user_data = <<-EOF
    #!/bin/bash
    set -euo pipefail

    # Update system
    apt-get update -y
    apt-get upgrade -y

    # Install Docker
    curl -fsSL https://get.docker.com | sh
    usermod -aG docker ubuntu

    # Install Docker Compose
    DOCKER_COMPOSE_VERSION="v2.27.0"
    curl -fsSL "https://github.com/docker/compose/releases/download/$${DOCKER_COMPOSE_VERSION}/docker-compose-linux-$(uname -m)" \
      -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose

    # Install AWS CLI
    curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
    apt-get install -y unzip
    unzip -q awscliv2.zip
    ./aws/install
    rm -rf aws awscliv2.zip

    # Create project directory
    mkdir -p /opt/phylospark
    chown ubuntu:ubuntu /opt/phylospark

    echo "PhyloSpark instance ready" > /opt/phylospark/READY
  EOF

  tags = {
    Name        = "phylospark-dev"
    Project     = "PhyloSpark"
    Environment = "dev"
    ManagedBy   = "terraform"
  }
}

# ─── Associate Elastic IP ──────────────────────────────
resource "aws_eip_association" "phylospark" {
  instance_id   = aws_instance.phylospark.id
  allocation_id = data.aws_eip.main.id
}
