"""Quick AWS resource audit."""
import boto3

ec2 = boto3.client("ec2")
s3 = boto3.client("s3")

print("=== EC2 INSTANCES ===")
for r in ec2.describe_instances()["Reservations"]:
    for i in r["Instances"]:
        tags = {t["Key"]: t["Value"] for t in i.get("Tags", [])}
        print(f"  {i['InstanceId']} | {i['State']['Name']} | {i['InstanceType']} | {tags.get('Name','')}")

print("\n=== S3 BUCKETS ===")
for b in s3.list_buckets()["Buckets"]:
    print(f"  {b['Name']}")

print("\n=== VPCs ===")
for v in ec2.describe_vpcs()["Vpcs"]:
    tags = {t["Key"]: t["Value"] for t in v.get("Tags", [])}
    print(f"  {v['VpcId']} | {v['CidrBlock']} | default={v['IsDefault']} | {tags.get('Name','')}")

print("\n=== ELASTIC IPs ===")
for e in ec2.describe_addresses()["Addresses"]:
    print(f"  {e.get('PublicIp')} | instance={e.get('InstanceId','unattached')}")

print("\n=== KEY PAIRS ===")
for k in ec2.describe_key_pairs()["KeyPairs"]:
    print(f"  {k['KeyName']}")

print("\n=== SECURITY GROUPS (non-default) ===")
for sg in ec2.describe_security_groups()["SecurityGroups"]:
    if sg["GroupName"] != "default":
        print(f"  {sg['GroupId']} | {sg['GroupName']}")
