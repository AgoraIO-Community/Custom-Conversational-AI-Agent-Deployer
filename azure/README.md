# Custom Conversational AI Agent

This folder contains the infrastructure as code for deploying a custom conversational agent. The infrastructure deploys a scalable system on Azure that includes agent instances, a proxy router, and a Redis database, managed using Pulumi.

## Prerequisites

- [Pulumi CLI](https://www.pulumi.com/docs/get-started/install/)
- [Node.js](https://nodejs.org/) (v14 or later)
- [Azure Account](https://azure.microsoft.com/)
- [Azure CLI](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli)
- [Docker](https://www.docker.com/get-started) (for local development)

## Configuration

1. Set up your Pulumi stack:

```bash
pulumi stack init dev
```

2. Configure the required secrets:

```bash
pulumi config set --secret azure:clientId <YOUR_AZURE_CLIENT_ID>
pulumi config set --secret azure:clientSecret <YOUR_AZURE_CLIENT_SECRET>
pulumi config set --secret azure:tenantId <YOUR_AZURE_TENANT_ID>
pulumi config set --secret azure:subscriptionId <YOUR_AZURE_SUBSCRIPTION_ID>
pulumi config set --secret agoraAppId <YOUR_AGORA_APP_ID>
pulumi config set --secret agoraAppCert <YOUR_AGORA_APP_CERT>
pulumi config set --secret openaiApiKey <YOUR_OPENAI_API_KEY>
pulumi config set openaiModel <OPENAI_MODEL_NAME>
pulumi config set maxRequestsPerBackend <MAX_REQUESTS>
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

2. Deploy the infrastructure:

```bash
pulumi up
```

## Cleanup

To destroy the infrastructure:

```bash
pulumi destroy
```

## Infrastructure Outputs

After deployment, you can access important information using:

```bash
pulumi stack output
```

This will show:

- Redis host and port
- Agent resource IDs
- Proxy Router resource ID and public IP
- Azure Container Registry login server

## Development

The infrastructure code is in `index.ts` and includes:

- Azure Container Registry setup
- Virtual Network configuration with public/private subnets
- Agent VM creation and configuration
- Proxy router deployment
- Redis Cache setup
- Network security configuration

## Architecture

The infrastructure consists of:

- **Virtual Network**
  - Public and private subnets
  - Network security groups for access control
  - Configured address space: 10.0.0.0/16

- **Azure Container Registry (ACR)**
  - Basic SKU registry
  - Hosts Docker images for proxy and agent
  - Admin access enabled for Docker authentication

- **Compute Resources**
  - Agent VMs (3x Standard_F4s_v2)
    - 4 vCPUs, 8GB RAM per instance
    - Deployed in private subnet
    - Running containerized OpenAI agents
    - Configured with Agora RTC support
    - Auto-configured with Docker and ACR login
  - Proxy Router VM (Standard_B1s)
    - Deployed in public subnet
    - Handles load balancing and request routing
    - Manages agent connection mapping

- **Azure Cache for Redis**
  - Basic SKU, 1GB cache
  - Non-SSL port enabled
  - Used for session state and routing information

- **Network Security Groups**
  - Agent NSG
    - Allows HTTP (8080)
    - Allows Agora RTC (UDP 1024-65535)
  - Proxy NSG
    - Allows HTTP (8080)
    - Controls access to backend services

## Security Notes

- All components run within a dedicated Virtual Network
- Private subnet used for agent instances
- Network Security Groups implement principle of least privilege
- All sensitive configuration stored as Pulumi secrets
- Azure Container Registry authentication required
- Proxy router controls access to backend services

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a new Pull Request 