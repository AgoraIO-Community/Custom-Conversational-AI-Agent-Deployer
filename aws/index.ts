import * as pulumi from '@pulumi/pulumi'
import * as aws from '@pulumi/aws'
import * as docker from '@pulumi/docker'
import * as awsx from '@pulumi/awsx'
import * as random from '@pulumi/random'

// Get config
const config = new pulumi.Config()
const awsRegion = aws.config.requireRegion()

// Docker build options
const dockerBuildOptions = {
  platform: 'linux/amd64',
  args: {
    BUILDKIT_INLINE_CACHE: '1',
    BUILD_ARGS: '--progress=plain --no-cache',
  },
}

const appName = 'custom-agent'

// Create a Virtual Private Cloud (VPC) with explicit subnet configuration
const vpc = new awsx.ec2.Vpc('custom-agent-vpc', {
  numberOfAvailabilityZones: 2,
  subnetStrategy: 'Auto',
  subnetSpecs: [
    {
      type: awsx.ec2.SubnetType.Public,
      cidrMask: 20,
    },
    {
      type: awsx.ec2.SubnetType.Private,
      cidrMask: 20,
    },
  ],
  natGateways: {
    strategy: 'Single', // Or "OnePerAz" if you need one NAT Gateway per AZ
  },
})

// Create ECR repositories for our images
const proxyRegistry = new aws.ecr.Repository('proxy-router-repo', {
  name: `${appName}-proxy-router`,
  forceDelete: true,
})

const agentRegistry = new aws.ecr.Repository('agent-repo', {
  name: `${appName}-agent`,
  forceDelete: true,
})

// Helper function to get ECR credentials
const getEcrCredentials = async () => {
  const caller = await aws.getCallerIdentity()
  const credentials = await aws.ecr.getCredentials({
    registryId: caller.accountId,
  })
  const decodedCredentials = Buffer.from(credentials.authorizationToken, 'base64').toString()
  const [username, password] = decodedCredentials.split(':')
  return {
    server: credentials.proxyEndpoint,
    username,
    password,
  }
}

// Build and push the proxy router image
const proxyImage = new docker.Image('proxy-router', {
  imageName: pulumi.interpolate`${proxyRegistry.repositoryUrl}:latest`,
  build: {
    context: '../conversational-ai-agent-router',
    dockerfile: '../conversational-ai-agent-router/Dockerfile',
    ...dockerBuildOptions,
  },
  registry: pulumi.output(getEcrCredentials()),
})

// Build and push the agent image
const agentImage = new docker.Image('realtime-agent', {
  imageName: pulumi.interpolate`${agentRegistry.repositoryUrl}:latest`,
  build: {
    context: '../openai-realtime-python',
    dockerfile: '../openai-realtime-python/Dockerfile',
    ...dockerBuildOptions,
  },
  registry: pulumi.output(getEcrCredentials()),
})

// Create ElastiCache (Redis) subnet group
const redisSubnetGroup = new aws.elasticache.SubnetGroup('redis-subnet-group', {
  subnetIds: vpc.privateSubnetIds,
})

// Create agent security group first
const agentSecurityGroup = new aws.ec2.SecurityGroup('agent-security-group', {
  vpcId: vpc.vpcId,
  ingress: [
    // HTTP API access
    {
      protocol: 'tcp',
      fromPort: 8080,
      toPort: 8080,
      cidrBlocks: ['0.0.0.0/0'],
      ipv6CidrBlocks: ['::/0'],
    },
    // Internal VPC access (allow instances to talk to each other)
    { protocol: 'tcp', fromPort: 0, toPort: 65535, self: true },
    // Agora RTC UDP ports
    {
      protocol: 'udp',
      fromPort: 1024,
      toPort: 65535,
      cidrBlocks: ['0.0.0.0/0'],
    },
  ],
  egress: [{ protocol: '-1', fromPort: 0, toPort: 0, cidrBlocks: ['0.0.0.0/0'] }],
  tags: {
    Name: `${appName}-agent-security-group`,
  },
})

// Create a dedicated security group for the proxy router
const proxySecurityGroup = new aws.ec2.SecurityGroup('proxy-security-group', {
  vpcId: vpc.vpcId,
  ingress: [
    // HTTP API access
    {
      protocol: 'tcp',
      fromPort: 8080,
      toPort: 8080,
      cidrBlocks: ['0.0.0.0/0'],
      ipv6CidrBlocks: ['::/0'],
    },
  ],
  egress: [{ protocol: '-1', fromPort: 0, toPort: 0, cidrBlocks: ['0.0.0.0/0'] }],
  tags: {
    Name: `${appName}-proxy-security-group`,
  },
})

// Update Redis security group to only allow access from proxy
const redisSecurityGroup = new aws.ec2.SecurityGroup('redis-security-group', {
  vpcId: vpc.vpcId,
  ingress: [
    {
      protocol: 'tcp',
      fromPort: 6379,
      toPort: 6379,
      securityGroups: [proxySecurityGroup.id],
      description: 'Allow Redis access from proxy router',
    },
  ],
  tags: {
    Name: `${appName}-redis-security-group`,
  },
})

// Generate a random password for Redis
const redisAuthToken = new random.RandomPassword('redis-auth-token', {
  length: 16,
  special: false,
})

// Create Redis cluster
const redis = new aws.elasticache.ReplicationGroup('custom-agent-redis', {
  replicationGroupId: 'custom-agent-redis',
  description: 'Redis replication group for custom agent',
  nodeType: 'cache.t3.micro',
  numCacheClusters: 1,
  automaticFailoverEnabled: false,
  engine: 'redis',
  engineVersion: '7.0',
  port: 6379,
  subnetGroupName: redisSubnetGroup.name,
  securityGroupIds: [redisSecurityGroup.id],
  atRestEncryptionEnabled: true,
  transitEncryptionEnabled: true,
  authToken: redisAuthToken.result,
  authTokenUpdateStrategy: 'ROTATE',
})

// Update Redis URL to include the password
const redisUrl = pulumi.interpolate`redis://default:${redisAuthToken.result}@${redis.primaryEndpointAddress}:6379`

// Create IAM role for EC2 instances
const ec2Role = new aws.iam.Role('ec2-role', {
  assumeRolePolicy: JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Action: 'sts:AssumeRole',
        Effect: 'Allow',
        Principal: { Service: 'ec2.amazonaws.com' },
      },
    ],
  }),
})

// Attach policies to allow ECR access
new aws.iam.RolePolicyAttachment('ecr-policy', {
  role: ec2Role.name,
  policyArn: 'arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly',
})

// Add Systems Manager policy
new aws.iam.RolePolicyAttachment('ssm-policy', {
  role: ec2Role.name,
  policyArn: 'arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore',
})

const instanceProfile = new aws.iam.InstanceProfile('instance-profile', {
  role: ec2Role.name,
})

// Helper function to create agent instances
const createAgentInstance = (name: string, index: number) => {
  return new aws.ec2.Instance(name, {
    ami: aws.ec2.getAmiOutput({
      mostRecent: true,
      owners: ['amazon'],
      filters: [
        {
          name: 'name',
          values: ['amzn2-ami-hvm-*-x86_64-gp2'],
        },
      ],
    }).id,
    instanceType: 'c5.xlarge',
    subnetId: vpc.publicSubnetIds[index % 2],
    vpcSecurityGroupIds: [agentSecurityGroup.id],
    iamInstanceProfile: instanceProfile.name,
    userData: pulumi.interpolate`#!/bin/bash
set -euo pipefail

exec 1>/var/log/agent-startup.log 2>&1

echo "=== Starting agent setup at $(date) ==="

function log() {
    echo "[$(date)]: $1"
}

# Wait for any existing yum processes to finish
log "Waiting for yum lock to be released..."
while pgrep -f yum > /dev/null; do
    log "Waiting for other yum processes to finish..."
    sleep 5
done

# Update system and install Docker
log "Updating system packages..."
yum update -y

log "Installing Docker..."
yum install -y docker
systemctl start docker
systemctl enable docker

# Add ec2-user to docker group with proper permissions
log "Configuring Docker permissions..."
usermod -a -G docker ec2-user
usermod -a -G docker ssm-user

# Restart Docker to ensure group changes take effect
log "Restarting Docker service..."
systemctl restart docker

# Wait for Docker to be ready
log "Waiting for Docker service to be fully available..."
for i in {1..30}; do
    if docker info >/dev/null 2>&1; then
        log "Docker is ready"
        break
    fi
    log "Attempt $i: Docker not ready yet..."
    sleep 10
done

# Login to ECR
log "Logging into ECR..."
aws ecr get-login-password --region ${awsRegion} | docker login --username AWS --password-stdin ${agentRegistry.repositoryUrl}

# Create environment file
log "Creating environment file..."
cat > /etc/agent.env << EOL
AGORA_APP_ID=${config.requireSecret('agoraAppId')}
AGORA_APP_CERT=${config.requireSecret('agoraAppCert')}
OPENAI_API_KEY=${config.requireSecret('openaiApiKey')}
OPENAI_MODEL=${config.require('openaiModel')}
SERVER_PORT=8080
REALTIME_API_BASE_URI=wss://api.openai.com
WRITE_AGENT_PCM=false
WRITE_RTC_PCM=false
EOL

log "Environment file created"

# Pull and run container
log "Pulling agent image..."
docker pull ${agentImage.imageName}

log "Starting agent container..."
docker run -d \
    --name agent \
    -p 8080:8080 \
    --env-file /etc/agent.env \
    -v /etc/agent.env:/app/.env:ro \
    --restart unless-stopped \
    ${agentImage.imageName}

# Verify container is running
if ! docker ps | grep agent; then
    log "Container failed to start. Docker logs:"
    docker logs agent
    exit 1
fi

log "=== Agent setup complete at $(date) ==="
`,
  })
}

// Create agent instances
const agents = Array.from({ length: 3 }, (_, i) => createAgentInstance(`agent-${i + 1}`, i))

// Combine all agent private IPs into one comma-separated string
const agentIps = pulumi.all(agents.map((agent) => agent.privateIp)).apply((ips) => ips.join(','))

// Create proxy router instance
const routerUserData = pulumi.interpolate`#!/bin/bash
set -euo pipefail

# Redirect all output to log file
exec 1>/var/log/proxy-startup.log 2>&1

function log() {
    echo "[$(date)]: $1"
}

log "=== Starting initialization script at $(date) ==="
log "Image name: ${proxyImage.imageName}"
log "Redis host: ${redis.primaryEndpointAddress}"
log "Agent IPs: ${agentIps}"

# Install necessary dependencies
log "Updating system packages..."
yum update -y
if [ $? -ne 0 ]; then
    log "ERROR: System update failed"
    exit 1
fi

log "Installing Docker..."
yum install -y docker
if [ $? -ne 0 ]; then
    log "ERROR: Docker installation failed"
    exit 1
fi

# Start and enable Docker service
log "Starting Docker service..."
systemctl start docker
systemctl enable docker
systemctl status docker --no-pager

# Wait for Docker to be ready (with timeout)
log "Waiting for Docker to be ready..."
TIMEOUT=60
while [ $TIMEOUT -gt 0 ] && ! docker info >/dev/null 2>&1; do
    log "Docker not ready, waiting... ($TIMEOUT seconds left)"
    sleep 5
    TIMEOUT=$((TIMEOUT - 5))
done

if [ $TIMEOUT -le 0 ]; then
    log "ERROR: Docker failed to start within timeout"
    log "Docker daemon status:"
    systemctl status docker --no-pager
    log "Docker daemon logs:"
    journalctl -u docker --no-pager | tail -n 50
    exit 1
fi

log "Docker is ready. Docker version:"
docker version
docker info

# Configure Docker credentials for ECR
log "Configuring ECR credentials..."
aws ecr get-login-password --region ${awsRegion} | docker login --username AWS --password-stdin ${proxyRegistry.repositoryUrl}

if [ $? -ne 0 ]; then
    log "ERROR: Failed to log into ECR"
    log "AWS CLI version:"
    aws --version
    log "AWS region: ${awsRegion}"
    log "ECR endpoint: ${proxyRegistry.repositoryUrl}"
    exit 1
fi

# Create environment file
echo "Creating environment file..."
cat > /etc/proxy.env << EOL
BACKEND_IPS=${agentIps}
MAX_REQUESTS_PER_BACKEND=${config.require('maxRequestsPerBackend')}
REDIS_URL=${redisUrl}
PORT=8080
ALLOW_ORIGIN=*
MAPPING_TTL_IN_S=3600
EOL

log "Environment file created:"
cat /etc/proxy.env | grep -v "KEY"

# Pull the container image
log "Pulling container image: ${proxyImage.imageName}"
docker pull ${proxyImage.imageName}

if [ $? -ne 0 ]; then
    log "ERROR: Failed to pull container image"
    log "Docker pull logs:"
    docker pull ${proxyImage.imageName} 2>&1
    log "Network connectivity test:"
    curl -v ${proxyRegistry.repositoryUrl}
    exit 1
fi

# Start the container
echo "Starting container..."
docker run -d \
    --name proxy \
    --restart unless-stopped \
    -p 8080:8080 \
    --env-file /etc/proxy.env \
    -v /etc/proxy.env:/app/.env:ro \
    ${proxyImage.imageName}

# Verify container is running
RETRY_COUNT=5
while [ $RETRY_COUNT -gt 0 ]; do
    if docker ps | grep proxy > /dev/null; then
        log "Container started successfully"
        log "Container details:"
        docker ps --format "{{.ID}}\t{{.Status}}\t{{.Ports}}" | grep proxy
        log "Container logs:"
        docker logs proxy
        log "=== Initialization completed successfully ==="
        exit 0
    fi
    echo "Waiting for container to start... (attempts left: $RETRY_COUNT)"
    sleep 10
    RETRY_COUNT=$((RETRY_COUNT - 1))
done

log "ERROR: Container failed to start. Diagnostic information:"
log "1. Docker logs:"
docker logs proxy || true
log "2. Docker container status:"
docker ps -a | grep proxy || true
log "3. Docker service status:"
systemctl status docker --no-pager
log "4. System resources:"
free -m
df -h
log "5. Network status:"
netstat -tulpn | grep LISTEN
log "=== Initialization failed ==="
exit 1`

const proxyRouter = new aws.ec2.Instance('proxy-router', {
  ami: aws.ec2.getAmiOutput({
    mostRecent: true,
    owners: ['amazon'],
    filters: [
      {
        name: 'name',
        values: ['amzn2-ami-hvm-*-x86_64-gp2'],
      },
    ],
  }).id,
  instanceType: 't3.micro',
  subnetId: vpc.publicSubnetIds[0],
  vpcSecurityGroupIds: [proxySecurityGroup.id],
  iamInstanceProfile: instanceProfile.name,
  userData: routerUserData,
})

// Export important infrastructure information
export const outputs = {
  redis: {
    host: redis.primaryEndpointAddress,
    port: redis.port,
  },
  agents: {
    publicIps: agents.map((agent) => agent.publicIp),
    privateIps: agents.map((agent) => agent.privateIp),
  },
  proxy: {
    publicIp: proxyRouter.publicIp,
    privateIp: proxyRouter.privateIp,
  },
  registries: {
    proxyUrl: proxyRegistry.repositoryUrl,
    agentUrl: agentRegistry.repositoryUrl,
  },
}
