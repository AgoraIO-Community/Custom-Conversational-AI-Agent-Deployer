import * as pulumi from '@pulumi/pulumi';
import * as resources from '@pulumi/azure-native/resources';
import * as network from '@pulumi/azure-native/network';
import * as compute from '@pulumi/azure-native/compute';
import * as containerregistry from '@pulumi/azure-native/containerregistry';
import * as cache from '@pulumi/azure-native/cache';
import * as docker from '@pulumi/docker';

// Get config
const config = new pulumi.Config();

// Docker build options
const dockerBuildOptions = {
  platform: 'linux/amd64',
  args: {
    BUILDKIT_INLINE_CACHE: '1',
    BUILD_ARGS: '--progress=plain --no-cache',
  },
};

const appName = 'custom-agent';
const sshPublicKey = config.require('sshPublicKey');

// Create a resource group
const resourceGroup = new resources.ResourceGroup(`${appName}-rg`);

// Create Virtual Network with explicit subnet outputs
const vnet = new network.VirtualNetwork(`${appName}-vnet`, {
  resourceGroupName: resourceGroup.name,
  addressSpace: {
    addressPrefixes: ['10.0.0.0/16'],
  },
  subnets: [
    {
      name: 'public-subnet',
      addressPrefix: '10.0.1.0/24',
    },
    {
      name: 'private-subnet',
      addressPrefix: '10.0.2.0/24',
    },
  ],
});

// Get subnet references with proper chaining
const publicSubnet = vnet.subnets.apply((subnets) => subnets?.[0]?.id);
const privateSubnet = vnet.subnets.apply((subnets) => subnets?.[1]?.id);

// Create Azure Container Registry
const registryName = appName.toLowerCase().replace(/[^a-z0-9]/g, '');
const acr = new containerregistry.Registry(`${registryName}Registry`, {
  resourceGroupName: resourceGroup.name,
  sku: {
    name: 'Basic',
  },
  adminUserEnabled: true,
});

// Get ACR credentials
const acrCredentials = pulumi.all([resourceGroup.name, acr.name]).apply(async ([rgName, acrName]) => {
  const creds = await containerregistry.listRegistryCredentials({
    resourceGroupName: rgName,
    registryName: acrName,
  });
  return {
    server: acr.loginServer,
    username: creds.username!,
    password: creds.passwords![0].value!,
  };
});

// Build and push the proxy router image
const proxyImage = new docker.Image(`${appName}-proxy-router`, {
  imageName: pulumi.interpolate`${acr.loginServer}/proxy-router:latest`,
  build: {
    context: '../conversational-ai-agent-router',
    dockerfile: '../conversational-ai-agent-router/Dockerfile',
    ...dockerBuildOptions,
  },
  registry: acrCredentials,
});

// Build and push the agent image
const agentImage = new docker.Image(`${appName}-realtime-agent`, {
  imageName: pulumi.interpolate`${acr.loginServer}/realtime-agent:latest`,
  build: {
    context: '../openai-realtime-python',
    dockerfile: '../openai-realtime-python/Dockerfile',
    ...dockerBuildOptions,
  },
  registry: acrCredentials,
});

// Create Redis Cache
const redisCache = new cache.Redis(`${appName}-redis`, {
  resourceGroupName: resourceGroup.name,
  sku: {
    capacity: 1,
    family: 'C',
    name: 'Basic',
  },
  enableNonSslPort: true,
});

// Create Network Security Group for agents
const agentNsg = new network.NetworkSecurityGroup(`${appName}-agent-nsg`, {
  resourceGroupName: resourceGroup.name,
  securityRules: [
    {
      name: 'allow-http',
      priority: 100,
      direction: 'Inbound',
      access: 'Allow',
      protocol: 'Tcp',
      sourcePortRange: '*',
      destinationPortRange: '8080',
      sourceAddressPrefix: '*',
      destinationAddressPrefix: '*',
    },
    {
      name: 'allow-udp-agora',
      priority: 110,
      direction: 'Inbound',
      access: 'Allow',
      protocol: 'Udp',
      sourcePortRange: '*',
      destinationPortRange: '1024-65535',
      sourceAddressPrefix: '*',
      destinationAddressPrefix: '*',
    },
  ],
});

// Create Network Security Group for proxy
const proxyNsg = new network.NetworkSecurityGroup(`${appName}-proxy-nsg`, {
  resourceGroupName: resourceGroup.name,
  securityRules: [
    {
      name: 'allow-ssh',
      priority: 100,
      direction: 'Inbound',
      access: 'Allow',
      protocol: 'Tcp',
      sourcePortRange: '*',
      destinationPortRange: '22',
      sourceAddressPrefix: '*',
      destinationAddressPrefix: '*',
    },
    {
      name: 'allow-http',
      priority: 110,
      direction: 'Inbound',
      access: 'Allow',
      protocol: 'Tcp',
      sourcePortRange: '*',
      destinationPortRange: '8080',
      sourceAddressPrefix: '*',
      destinationAddressPrefix: '*',
    },
  ],
});

// Helper function to create agent VMs
const createAgentVm = (name: string, index: number) => {
  // Create public IP for the VM
  const publicIp = new network.PublicIPAddress(`${appName}-${name}-ip`, {
    resourceGroupName: resourceGroup.name,
    publicIPAllocationMethod: 'Dynamic',
  });

  // Create network interface
  const nic = new network.NetworkInterface(`${appName}-${name}-nic`, {
    resourceGroupName: resourceGroup.name,
    ipConfigurations: [
      {
        name: 'ipconfig',
        subnet: privateSubnet.apply((id) => ({ id })),
        publicIPAddress: {
          id: publicIp.id,
        },
      },
    ],
    networkSecurityGroup: {
      id: agentNsg.id,
    },
  });

  // Create the VM
  return new compute.VirtualMachine(`${appName}-${name}`, {
    resourceGroupName: resourceGroup.name,
    networkProfile: {
      networkInterfaces: [
        {
          id: nic.id,
        },
      ],
    },
    hardwareProfile: {
      //  vmSize: 'Standard_F4s_v2', // 4 vCPUs, 8 GB RAM
      vmSize: 'Standard_D2s_v3', // 2 vCPUs, 8 GB RAM - Smaller VM size (for basic tier)
    },
    osProfile: {
      computerName: `${appName}-${name}`,
      adminUsername: 'azureuser',
      linuxConfiguration: {
        disablePasswordAuthentication: true,
        ssh: {
          publicKeys: [
            {
              path: `/home/azureuser/.ssh/authorized_keys`,
              keyData: sshPublicKey,
            },
          ],
        },
      },
      customData: Buffer.from(
        `#!/bin/bash
set -euo pipefail

exec 1> >(logger -s -t $(basename $0)) 2>&1

echo "[startup] Beginning custom data script execution..."

# Install Docker
echo "[startup] Installing Docker..."
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Login to ACR using credentials directly
echo "[startup] Logging into ACR..."
docker login ${acr.loginServer} -u ${acrCredentials.apply((creds) => creds.username)} -p ${acrCredentials.apply(
          (creds) => creds.password,
        )}

# Create environment file
echo "[startup] Creating environment file..."
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

# Pull and run agent container
echo "[startup] Pulling agent container..."
docker pull ${agentImage.imageName}
echo "[startup] Starting agent container..."
docker run -d \\
    --name agent \\
    -p 8080:8080 \\
    --env-file /etc/agent.env \\
    --restart unless-stopped \\
    ${agentImage.imageName}

echo "[startup] Startup script completed."
`,
      ).toString('base64'),
    },
    storageProfile: {
      imageReference: {
        publisher: 'Canonical',
        offer: 'UbuntuServer',
        sku: '18.04-LTS',
        version: 'latest',
      },
      osDisk: {
        name: `${appName}-${name}-disk`,
        createOption: 'FromImage',
      },
    },
  });
};

// Create agent VMs
const agents = Array.from({ length: 3 }, (_, i) => createAgentVm(`agent-${i + 1}`, i));

// Create proxy router VM
const proxyPublicIp = new network.PublicIPAddress(`${appName}-proxy-ip`, {
  resourceGroupName: resourceGroup.name,
  publicIPAllocationMethod: 'Static',
});

const proxyNic = new network.NetworkInterface(`${appName}-proxy-nic`, {
  resourceGroupName: resourceGroup.name,
  ipConfigurations: [
    {
      name: 'ipconfig',
      subnet: publicSubnet.apply((id) => ({ id })),
      publicIPAddress: {
        id: proxyPublicIp.id,
      },
    },
  ],
  networkSecurityGroup: {
    id: proxyNsg.id,
  },
});

// Get agent private IPs
const agentIps = pulumi.output(agents).apply(async (vms) => {
  // In a real implementation, you would need to fetch the private IPs of the agent VMs
  // This is a simplified version
  return vms.map((vm) => vm.id).join(',');
});

const proxyVm = new compute.VirtualMachine(`${appName}-proxy-router`, {
  resourceGroupName: resourceGroup.name,
  networkProfile: {
    networkInterfaces: [
      {
        id: proxyNic.id,
      },
    ],
  },
  hardwareProfile: {
    vmSize: 'Standard_B1s',
  },
  osProfile: {
    computerName: `${appName}-proxy-router`,
    adminUsername: 'azureuser',
    linuxConfiguration: {
      disablePasswordAuthentication: true,
      ssh: {
        publicKeys: [
          {
            path: `/home/azureuser/.ssh/authorized_keys`,
            keyData: sshPublicKey,
          },
        ],
      },
    },
    customData: pulumi
      .all([
        agentIps,
        redisCache.hostName,
        redisCache.accessKeys.primaryKey,
        proxyImage.imageName,
        acr.loginServer,
        acrCredentials,
      ])
      .apply(([ips, redisHost, redisPrimaryKey, imageName, acrServer, creds]) => {
        const script = `#!/bin/bash
set -euo pipefail

exec 1> >(logger -s -t $(basename $0)) 2>&1

echo "[startup] Beginning custom data script execution..."

# Install Docker
echo "[startup] Installing Docker..."
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Install Azure CLI
echo "[startup] Installing Azure CLI..."
curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash

# Login to ACR using Azure CLI
echo "[startup] Logging into ACR..."
az acr login --name ${acrServer} --username ${creds.username} --password "${creds.password}"

# Create environment file
echo "[startup] Creating environment file..."
cat > /etc/proxy.env << 'EOL'
BACKEND_IPS=${ips}
MAX_REQUESTS_PER_BACKEND=${config.require('maxRequestsPerBackend')}
REDIS_URL=redis://:${redisPrimaryKey}@${redisHost}:6379
PORT=8080
ALLOW_ORIGIN=*
MAPPING_TTL_IN_S=3600
EOL

# Pull and run proxy container
echo "[startup] Pulling proxy container..."
docker pull ${imageName}

echo "[startup] Starting proxy container..."
docker run -d \\
    --name proxy \\
    -p 8080:8080 \\
    --env-file /etc/proxy.env \\
    --restart unless-stopped \\
    ${imageName}

echo "[startup] Startup script completed."`;
        return Buffer.from(script).toString('base64');
      }),
  },
  storageProfile: {
    imageReference: {
      publisher: 'Canonical',
      offer: 'UbuntuServer',
      sku: '18.04-LTS',
      version: 'latest',
    },
    osDisk: {
      name: `${appName}-proxy-disk`,
      createOption: 'FromImage',
    },
  },
});

// Export important infrastructure information
export const outputs = {
  redis: {
    host: redisCache.hostName,
    port: 6379,
  },
  agents: {
    resourceIds: agents.map((agent) => agent.id),
  },
  proxy: {
    resourceId: proxyVm.id,
    publicIpId: proxyPublicIp.id,
    publicIp: proxyPublicIp.ipAddress,
  },
  registry: {
    loginServer: acr.loginServer,
  },
};
