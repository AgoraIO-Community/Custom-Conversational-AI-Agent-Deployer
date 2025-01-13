# Custom Conversational AI Agent

This folder contains the infrastructure as code for deploying a custom conversational agent. The infrastructure deploys a scalable system on AWS that includes agent instances, a proxy router, and a Redis database, managed using Pulumi.

## Architecture

The infrastructure consists of:

- **VPC Infrastructure**

  - Configured across 2 availability zones
  - Public and private subnets (CIDR mask /20)
  - NAT Gateways (one per AZ) for private subnet internet access

- **Container Registry (ECR)**

  - Proxy Router Repository
  - Agent Repository

- **Compute Resources**

  - Agent Instances (3x c5.xlarge)
    - Deployed in private subnets
    - Running containerized OpenAI agents
    - Configured with Agora RTC support
  - Proxy Router Instance (t3.micro)
    - Deployed in public subnet
    - Handles load balancing and request routing
    - Manages agent connection mapping

- **Redis Cluster**

  - ElastiCache Redis 7.0
  - Single node configuration (cache.t3.micro)
  - Encryption at rest and in transit
  - Authentication enabled
  - Used for session state and routing information

- **Security Groups**

  - Agent Security Group
    - Allows HTTP (8080)
    - Allows Agora RTC (UDP 1024-65535)
    - Allows internal VPC communication
  - Proxy Security Group
    - Allows HTTP (8080)
  - Redis Security Group
    - Allows access only from proxy router (6379)

- **IAM Configuration**
  - EC2 instance profile with:
    - ECR read access
    - Systems Manager access

## Prerequisites

- [Pulumi CLI](https://www.pulumi.com/docs/get-started/install/)
- [Node.js](https://nodejs.org/) (v14 or later)
- [AWS Account](https://aws.amazon.com/)
- [Docker](https://www.docker.com/get-started) (for local development)

## Configuration

1. Set up your Pulumi stack:

```bash
pulumi stack init dev
```

2. Configure the required secrets:

```bash
pulumi config set --secret aws:accessKey <YOUR_AWS_ACCESS_KEY>
pulumi config set --secret aws:secretKey <YOUR_AWS_SECRET_KEY>
pulumi config set --secret aws:region <YOUR_AWS_REGION>
pulumi config set --secret agoraAppId <YOUR_AGORA_APP_ID>
pulumi config set --secret agoraAppCert <YOUR_AGORA_APP_CERT>
pulumi config set --secret openaiApiKey <YOUR_OPENAI_API_KEY>
pulumi config set systemInstruction "Your custom system prompt here..."
```

3. Deploy using Pulumi:

```bash
pulumi preview  # Review changes
pulumi up       # Deploy infrastructure
```

## Deployment

1. Preview the changes:

```bash
pulumi preview
```

2. Deploy the infrastructure using DigitalOcean:

```bash
pulumi up
```

## Infrastructure Outputs

After deployment, you can access important information using:

```bash
pulumi stack output
```

This will show:

- Redis URI
- Agent IP addresses
- Proxy Router IP address

## Development

The infrastructure code is in `index.ts` and includes:

- Container registry setup
- Agent droplet creation
- Proxy router configuration
- Network and security settings

## Cleanup

To destroy the infrastructure:

```bash
pulumi destroy
```

## Security Notes

- All components run within a dedicated VPC
- Private subnets used for agent instances and Redis
- Redis encryption enabled both at rest and in transit
- Security groups implement principle of least privilege
- IAM roles configured with minimal required permissions
- All sensitive configuration stored as Pulumi secrets
- Authentication required for Redis access
- Proxy router controls access to backend services

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a new Pull Request
