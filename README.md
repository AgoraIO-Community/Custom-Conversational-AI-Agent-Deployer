# custom_conversational_ai

This repository contains Pulumi scripts for deploying a custom conversational AI agents using scripting to setup the infrastructure.

Platforms:

- [AWS](aws/README.md)
- Azure **(Coming Soon)**
- [DigitalOcean](digital-ocean/README.md)
- GCP **(Coming Soon)**

## Prerequisites

- [Pulumi CLI](https://www.pulumi.com/docs/get-started/install/)
- [Node.js](https://nodejs.org/) (v14 or later)

## Installation

1. Clone the repository:

```bash
git clone https://github.com/AgoraIO-Community/custom_conversational_ai
cd custom_conversational_ai
```

1. Run the clone script to fetch agent and router repositories:

```bash
./clone_repos.sh
```

1. Navigate to the platform you want to deploy to:

AWS

```bash
cd aws
```

DigitalOcean

```bash
cd digital-ocean
```

3. Open the `README.md` file for the platform you want to deploy to and follow the instructions to configure the secrets and deploy the infrastructure.

## Scaling

Currently the deployment is set up to run 3 agent instances on relatively modest hardware. This results in a maximum of 11-16 concurrent conversations per agent server and a maximum of 33-48 concurrent conversations.

We set the default maximum number of requests per backend to 11 to avoid overloading the agent instances, which results in a maximum of 33 concurrent conversations.

To scale up there are a two options that can be used separately or together:

1. Use more powerful instances for the agent instances
2. Increase the number of agent instances
