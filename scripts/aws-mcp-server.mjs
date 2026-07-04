import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import {
  EC2Client,
  DescribeInstancesCommand,
  DescribeSecurityGroupsCommand,
} from "@aws-sdk/client-ec2";
import {
  LambdaClient,
  ListFunctionsCommand,
} from "@aws-sdk/client-lambda";
import {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
  FilterLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import {
  STSClient,
  GetCallerIdentityCommand,
} from "@aws-sdk/client-sts";

const server = new Server(
  { name: "aws-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

function getClient(ClientClass, region) {
  return new ClientClass({ region: region || process.env.AWS_REGION || "us-east-1" });
}

const TOOLS = {
  aws_whoami: {
    description: "Get current AWS identity (account, user, ARN)",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const sts = getClient(STSClient);
      const identity = await sts.send(new GetCallerIdentityCommand({}));
      return formatResult(identity);
    },
  },
  aws_s3_list_buckets: {
    description: "List all S3 buckets",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const s3 = getClient(S3Client);
      const { Buckets } = await s3.send(new ListBucketsCommand({}));
      return formatResult(Buckets);
    },
  },
  aws_s3_list_objects: {
    description: "List objects in an S3 bucket",
    inputSchema: {
      type: "object",
      properties: {
        bucket: { type: "string", description: "S3 bucket name" },
        prefix: { type: "string", description: "Optional prefix filter" },
        region: { type: "string", description: "AWS region" },
      },
      required: ["bucket"],
    },
    handler: async ({ bucket, prefix, region }) => {
      const s3 = getClient(S3Client, region);
      const { Contents } = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }));
      return formatResult(Contents || []);
    },
  },
  aws_ec2_list_instances: {
    description: "Describe EC2 instances",
    inputSchema: {
      type: "object",
      properties: {
        region: { type: "string", description: "AWS region" },
        filters: { type: "string", description: "Optional JMESPath-like filter (e.g. tag:Name=web)" },
      },
    },
    handler: async ({ region, filters }) => {
      const ec2 = getClient(EC2Client, region);
      const params = {};
      if (filters) {
        const [key, value] = filters.split("=");
        params.Filters = [{ Name: key.replace(/^tag:/, "tag:"), Values: [value] }];
      }
      const { Reservations } = await ec2.send(new DescribeInstancesCommand(params));
      const instances = (Reservations || []).flatMap(r => r.Instances || []);
      return formatResult(instances);
    },
  },
  aws_lambda_list_functions: {
    description: "List Lambda functions",
    inputSchema: {
      type: "object",
      properties: {
        region: { type: "string", description: "AWS region" },
      },
    },
    handler: async ({ region }) => {
      const lambda = getClient(LambdaClient, region);
      const { Functions } = await lambda.send(new ListFunctionsCommand({}));
      return formatResult(Functions || []);
    },
  },
  aws_logs_list_groups: {
    description: "List CloudWatch log groups",
    inputSchema: {
      type: "object",
      properties: {
        region: { type: "string", description: "AWS region" },
        prefix: { type: "string", description: "Log group name prefix" },
      },
    },
    handler: async ({ region, prefix }) => {
      const logs = getClient(CloudWatchLogsClient, region);
      const { logGroups } = await logs.send(new DescribeLogGroupsCommand({ logGroupNamePrefix: prefix }));
      return formatResult(logGroups || []);
    },
  },
  aws_execute: {
    description: "Execute an arbitrary AWS SDK command (advanced). Provide the AWS service client and command name.",
    inputSchema: {
      type: "object",
      properties: {
        service: { type: "string", description: "AWS SDK v3 service client name (e.g. 'S3', 'EC2')" },
        command: { type: "string", description: "Command name (e.g. 'ListBuckets', 'DescribeInstances')" },
        params: { type: "object", description: "Command parameters as JSON object" },
        region: { type: "string", description: "AWS region" },
      },
      required: ["service", "command"],
    },
    handler: async ({ service, command, params, region }) => {
      const clientMap = { S3: S3Client, EC2: EC2Client, Lambda: LambdaClient, CloudWatchLogs: CloudWatchLogsClient, STS: STSClient };
      const ClientClass = clientMap[service];
      if (!ClientClass) {
        return { content: [{ type: "text", text: `Unsupported service: ${service}. Supported: ${Object.keys(clientMap).join(", ")}` }], isError: true };
      }
      const client = getClient(ClientClass, region);
      const { default: commandModule } = await import(`@aws-sdk/client-${service.toLowerCase()}`);
      const CommandClass = commandModule[`${command}Command`];
      if (!CommandClass) {
        return { content: [{ type: "text", text: `Command ${command} not found in @aws-sdk/client-${service.toLowerCase()}` }], isError: true };
      }
      const result = await client.send(new CommandClass(params || {}));
      return formatResult(result);
    },
  },
};

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: Object.entries(TOOLS).map(([name, tool]) => ({
    name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const tool = TOOLS[name];
  if (!tool) {
    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
  try {
    return await tool.handler(args || {});
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
  }
});

function formatResult(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

const transport = new StdioServerTransport();
await server.connect(transport);
