variable "aws_access_key" {
  type        = string
  sensitive   = true
  description = "AWS access key ID"
}

variable "aws_secret_key" {
  type        = string
  sensitive   = true
  description = "AWS secret access key"
}

variable "aws_region" {
  type        = string
  default     = "us-east-2"
  description = "AWS region"
}

variable "elastic_ip" {
  type        = string
  default     = "3.136.146.185"
  description = "Pre-allocated Elastic IP"
}

variable "instance_type" {
  type        = string
  default     = "t3.medium"
  description = "EC2 instance type (t3.medium = 2 vCPU, 4GB RAM)"
}

variable "ami_id" {
  type        = string
  default     = "ami-0ea3c35c5c3284d82"  # Ubuntu 22.04 LTS us-east-2
  description = "AMI ID for the EC2 instance"
}

variable "key_pair_name" {
  type        = string
  default     = "bigdata-lab-key"
  description = "Existing AWS key pair name"
}

variable "my_ip" {
  type        = string
  default     = "0.0.0.0/0"
  description = "Your IP in CIDR notation for SSH access"
}

variable "domain" {
  type        = string
  default     = "automation.com.mx"
  description = "Base domain for the platform"
}
