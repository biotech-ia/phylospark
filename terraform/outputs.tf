output "instance_id" {
  value       = aws_instance.phylospark.id
  description = "EC2 instance ID"
}

output "public_ip" {
  value       = var.elastic_ip
  description = "Public IP (Elastic IP)"
}

output "ssh_command" {
  value       = "ssh -i ${var.key_pair_name}.pem ubuntu@${var.elastic_ip}"
  description = "SSH command to connect"
}

output "s3_bucket" {
  value       = aws_s3_bucket.phylospark.bucket
  description = "S3 bucket name"
}

output "urls" {
  value = {
    frontend = "http://phylo.${var.domain}"
    api      = "http://api.phylo.${var.domain}"
    airflow  = "http://airflow.phylo.${var.domain}"
    minio    = "http://minio.phylo.${var.domain}"
  }
  description = "Service URLs"
}
