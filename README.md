# Custom Conversational AI Agents

Conversational AI Agents are semi-autonomous microservices that ingest audio streams with direct connections to large language models to process user conversations and return audio-native responses. This repository contains the scripting to setup the infrastructure for the agent servers.

For demo purposes we've created a simple [client](https://github.com/AgoraIO-Community/agora-openai-realtime-client) that you can use to test the agent.

Supported Hosting Services:

- [AWS](aws/README.md)
- Azure **([In Progress](https://github.com/AgoraIO-Community/Custom-Conversational-AI-Agent-Deployer/tree/azure/azure))**
- [DigitalOcean](digital-ocean/README.md)
- GCP **(Coming Soon)**

## Prerequisites

- [Agora Account](https://www.agora.io/en/signup/)
- [OpenAI Account](https://platform.openai.com/signup/)
- [Pulumi CLI](https://www.pulumi.com/docs/get-started/install/)
- [Node.js](https://nodejs.org/) (v14 or later)

## Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/AgoraIO-Community/custom_conversational_ai
   cd custom_conversational_ai
   ```

2. Run the clone script to fetch [agent](https://github.com/AgoraIO/openai-realtime-python) and [agent-router](https://github.com/AgoraIO-Community/openai-realtime-agent-router) repositories.

   ```bash
   ./clone_repos.sh
   ```

3. Navigate to the folder for the platform you want to deploy to:

   AWS

   ```bash
   cd aws
   ```

   DigitalOcean

   ```bash
   cd digital-ocean
   ```

4. Open the platform's `README.md` file and follow the instructions to configure the secrets and deploy the infrastructure.

## Customizing the System Prompt

To customize the system prompt, set the `systemInstruction` for the platform you want to deploy to, this will avoid modifying the agent code directly.

## Customizing the Agent's Tools

To customize the agent's tools, you will need to modify the agent code directly. After executing the clone script, you will find an example of how to add a new tool is defined in the `realtime_agent/realtime/tools_example.py` file. Once the tools are defined, initialize them in the `agent.py` file, and pass them to the agent as a parameter.

## Scaling

Currently the deployment is set up to run 3 agent instances on relatively modest hardware. This results in a maximum of 11-16 concurrent conversations per agent server and a maximum of 33-48 concurrent conversations.

We set the default maximum number of requests per backend to 11 to avoid overloading the agent instances, which results in a maximum of 33 concurrent conversations.

To scale up there are a two options that can be used separately or together:

1. Use more powerful instances for the agent instances
2. Increase the number of agent instances

## Contributing

We welcome contributions to this project. Please see the [CONTRIBUTING.md](CONTRIBUTING.md) file for more information.
