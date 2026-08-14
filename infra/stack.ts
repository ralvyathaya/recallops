import { join } from "node:path";
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  SecretValue,
  Stack,
  type StackProps,
} from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as events from "aws-cdk-lib/aws-events";
import * as eventTargets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNode from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as destinations from "aws-cdk-lib/aws-logs-destinations";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as secrets from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

export class RecallOpsStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const siteBucket = new s3.Bucket(this, "SiteBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    const evidenceBucket = new s3.Bucket(this, "EvidenceBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: [{ expiration: Duration.days(1), noncurrentVersionExpiration: Duration.days(1) }],
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const databaseSecret = new secrets.Secret(this, "DatabaseSecret", {
      description: "CockroachDB runtime connection URL; replace the placeholder after deployment",
      secretObjectValue: { url: SecretValue.unsafePlainText("replace-me") },
    });
    const mcpSecret = new secrets.Secret(this, "McpSecret", {
      description: "Cluster-scoped CockroachDB Cloud Managed MCP credentials",
      secretObjectValue: {
        apiKey: SecretValue.unsafePlainText("replace-me"),
        clusterId: SecretValue.unsafePlainText("replace-me"),
      },
    });
    const sessionSecret = new secrets.Secret(this, "SessionSecret", {
      generateSecretString: { secretStringTemplate: "{}", generateStringKey: "secret", passwordLength: 48, excludePunctuation: true },
    });

    const apiLogs = new logs.LogGroup(this, "ApiLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const workerLogs = new logs.LogGroup(this, "WorkerLogs", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const commonEnvironment = {
      DATABASE_SECRET_ARN: databaseSecret.secretArn,
      EVIDENCE_BUCKET: evidenceBucket.bucketName,
      USE_MOCK_SERVICES: "false",
      BEDROCK_REASONING_MODEL: "global.amazon.nova-2-lite-v1:0",
      BEDROCK_EMBEDDING_MODEL: "amazon.titan-embed-text-v2:0",
    };
    const apiFunction = new lambdaNode.NodejsFunction(this, "ApiFunction", {
      entry: join(__dirname, "../src/backend/api-handler.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: Duration.seconds(30),
      memorySize: 768,
      logGroup: apiLogs,
      environment: {
        ...commonEnvironment,
        MCP_SECRET_ARN: mcpSecret.secretArn,
        SESSION_SECRET_ARN: sessionSecret.secretArn,
      },
      bundling: { minify: true, sourceMap: true, target: "node22", externalModules: [] },
    });
    const workerFunction = new lambdaNode.NodejsFunction(this, "WorkerFunction", {
      entry: join(__dirname, "../src/backend/worker-handler.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: Duration.seconds(30),
      memorySize: 512,
      logGroup: workerLogs,
      environment: commonEnvironment,
      bundling: { minify: true, sourceMap: true, target: "node22", externalModules: [] },
    });

    databaseSecret.grantRead(apiFunction);
    databaseSecret.grantRead(workerFunction);
    mcpSecret.grantRead(apiFunction);
    sessionSecret.grantRead(apiFunction);
    evidenceBucket.grantReadWrite(apiFunction);
    evidenceBucket.grantRead(workerFunction);
    for (const fn of [apiFunction, workerFunction]) {
      fn.addToRolePolicy(new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel"],
        resources: ["*"],
      }));
    }

    new logs.SubscriptionFilter(this, "IncidentSignalSubscription", {
      logGroup: apiLogs,
      destination: new destinations.LambdaDestination(workerFunction),
      filterPattern: logs.FilterPattern.literal('"incident_signal"'),
    });
    new events.Rule(this, "CleanupSchedule", {
      schedule: events.Schedule.rate(Duration.hours(1)),
      targets: [new eventTargets.LambdaFunction(workerFunction)],
    });

    const api = new apigwv2.HttpApi(this, "HttpApi", {
      defaultIntegration: new HttpLambdaIntegration("ApiIntegration", apiFunction),
    });
    const stage = api.defaultStage?.node.defaultChild as apigwv2.CfnStage | undefined;
    if (stage) stage.defaultRouteSettings = { throttlingBurstLimit: 10, throttlingRateLimit: 5 };

    const distribution = new cloudfront.Distribution(this, "Distribution", {
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      additionalBehaviors: {
        "/api/*": {
          origin: new origins.HttpOrigin(`${api.apiId}.execute-api.${this.region}.${this.urlSuffix}`),
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: "/index.html", ttl: Duration.seconds(0) },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: "/index.html", ttl: Duration.seconds(0) },
      ],
    });
    new s3deploy.BucketDeployment(this, "DeploySite", {
      sources: [s3deploy.Source.asset(join(__dirname, "../out"))],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ["/*"],
    });

    new cloudwatch.Alarm(this, "ApiErrorsAlarm", {
      metric: apiFunction.metricErrors({ period: Duration.minutes(5) }), threshold: 1, evaluationPeriods: 1,
    });
    new cloudwatch.Alarm(this, "WorkerErrorsAlarm", {
      metric: workerFunction.metricErrors({ period: Duration.minutes(5) }), threshold: 1, evaluationPeriods: 1,
    });
    new cloudwatch.Alarm(this, "Api5xxAlarm", {
      metric: new cloudwatch.Metric({
        namespace: "AWS/ApiGateway",
        metricName: "5xx",
        dimensionsMap: { ApiId: api.apiId, Stage: "$default" },
        statistic: "Sum",
        period: Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
    });

    new CfnOutput(this, "DemoUrl", { value: `https://${distribution.distributionDomainName}` });
    new CfnOutput(this, "DatabaseSecretName", { value: databaseSecret.secretName });
    new CfnOutput(this, "McpSecretName", { value: mcpSecret.secretName });
    new CfnOutput(this, "EvidenceBucketName", { value: evidenceBucket.bucketName });
  }
}
