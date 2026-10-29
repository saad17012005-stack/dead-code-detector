import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // VPC
    const vpc = new ec2.Vpc(this, 'AiCodeDebtVpc', { maxAzs: 2 });

    // ECS Cluster
    const cluster = new ecs.Cluster(this, 'AiCodeDebtCluster', { vpc });

    // Redis (ElastiCache)
    const redisSubnetGroup = new elasticache.CfnSubnetGroup(this, 'RedisSubnetGroup', {
      description: 'Subnet group for Redis',
      subnetIds: vpc.privateSubnets.map(s => s.subnetId)
    });

    const redisSecurityGroup = new ec2.SecurityGroup(this, 'RedisSG', { vpc });
    redisSecurityGroup.addIngressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(6379));

    const redis = new elasticache.CfnCacheCluster(this, 'RedisCluster', {
      cacheNodeType: 'cache.t3.micro',
      engine: 'redis',
      numCacheNodes: 1,
      vpcSecurityGroupIds: [redisSecurityGroup.securityGroupId],
      cacheSubnetGroupName: redisSubnetGroup.ref,
    });

    // Postgres (RDS Aurora Serverless or RDS instance)
    const dbCredentialsSecret = new secretsmanager.Secret(this, 'DbCredentials', {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'ai_code_debt' }),
        generateStringKey: 'password',
        excludeCharacters: '"@/\\',
      },
    });

    const db = new rds.DatabaseInstance(this, 'PostgresDB', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_15 }),
      vpc,
      credentials: rds.Credentials.fromSecret(dbCredentialsSecret),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      databaseName: 'ai_code_debt',
    });

    const dbHost = db.instanceEndpoint.hostname;
    const redisHost = redis.attrRedisEndpointAddress;

    // Environment map shared across containers
    const sharedEnv = {
      PG_HOST: dbHost,
      PG_PORT: '5432',
      REDIS_HOST: redisHost,
      REDIS_PORT: '6379',
    };

    // Embedding Service (Python)
    const embeddingService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'EmbeddingService', {
      cluster,
      memoryLimitMiB: 2048,
      cpu: 1024,
      taskImageOptions: {
        image: ecs.ContainerImage.fromAsset('../', {
          file: 'packages/embedding-service/Dockerfile'
        }),
        containerPort: 8000,
      },
      publicLoadBalancer: false,
    });

    // API Service
    const apiService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'ApiService', {
      cluster,
      memoryLimitMiB: 1024,
      cpu: 512,
      taskImageOptions: {
        image: ecs.ContainerImage.fromAsset('../', { target: 'api' }),
        environment: sharedEnv,
        containerPort: 3001,
        secrets: {
          POSTGRES_PASSWORD: ecs.Secret.fromSecretsManager(dbCredentialsSecret, 'password')
        }
      },
      publicLoadBalancer: true,
    });

    // Web Dashboard Service
    const webService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'WebService', {
      cluster,
      memoryLimitMiB: 512,
      cpu: 256,
      taskImageOptions: {
        image: ecs.ContainerImage.fromAsset('../', { target: 'web' }),
        environment: {
          VITE_API_URL: apiService.loadBalancer.loadBalancerDnsName
        },
        containerPort: 3000,
      },
      publicLoadBalancer: true,
    });

    // Workers
    const workers = [
      'ingestion-worker',
      'analysis-worker',
      'similarity-worker',
      'reachability-worker',
      'provenance-worker',
      'llm-verifier-worker',
      'reporting-worker'
    ];

    for (const worker of workers) {
      const workerTask = new ecs.FargateTaskDefinition(this, `TaskDef-${worker}`, {
        memoryLimitMiB: 1024,
        cpu: 512,
      });

      workerTask.addContainer(`Container-${worker}`, {
        image: ecs.ContainerImage.fromAsset('../', { target: worker }),
        environment: {
          ...sharedEnv,
          ...(worker === 'similarity-worker' ? { EMBEDDING_SERVICE_URL: `http://${embeddingService.loadBalancer.loadBalancerDnsName}:8000` } : {})
        },
        secrets: {
          POSTGRES_PASSWORD: ecs.Secret.fromSecretsManager(dbCredentialsSecret, 'password')
        },
        logging: ecs.LogDrivers.awsLogs({ streamPrefix: worker })
      });

      new ecs.FargateService(this, `Service-${worker}`, {
        cluster,
        taskDefinition: workerTask,
      });
    }
  }
}
