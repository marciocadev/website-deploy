import { AccessLevel, Distribution, Function as CloudFrontFunction, FunctionCode, FunctionEventType, OriginAccessIdentity, ViewerProtocolPolicy, CachePolicy } from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { ManagedPolicy, OpenIdConnectPrincipal, OpenIdConnectProvider, Role } from 'aws-cdk-lib/aws-iam';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import { join } from 'path';

export class WebsiteDeployStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // github deploy
    const githubDomain = 'token.actions.githubusercontent.com';
    const githubOidcProvider = new OpenIdConnectProvider(this, "GithubOidcProvider", {
      url: `https://${githubDomain}`,
      clientIds: ['sts.amazonaws.com'],
    });

    const repositoryConfig: { owner: string; repo: string; filter?: string }[] = [
      {
        owner: "marciocadev",
        repo: "website-deploy",
      },
      {
        owner: "marciocadev",
        repo: "website-deploy",
        filter: "ref:refs/heads/main"
      },
    ]
    const iamRepoDeployAccess = repositoryConfig.map(
      (r) => `repo:${r.owner}/${r.repo}:${r.filter ?? '*'}`
    );
    new Role(this, "GithubDeployRole", {
      roleName: 'GitHubDeployRole',
      assumedBy: new OpenIdConnectPrincipal(
        githubOidcProvider,
        {
          StringEquals: {
            [`${githubDomain}:aud`]: 'sts.amazonaws.com',
          },
          StringLike: {
            [`${githubDomain}:sub`]: iamRepoDeployAccess
          },
        },
      ),
      managedPolicies: [
        // ManagedPolicy.fromAwsManagedPolicyName('AmazonS3FullAccess'),
        // ManagedPolicy.fromAwsManagedPolicyName('AWSCloudFormationFullAccess'),
        ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess'),
      ],
      maxSessionDuration: Duration.hours(1),
    });

    new CfnOutput(this, "aaa", {
      value: "aaa"
    })
    // github deploy

    const bucket = new Bucket(this, "WebsiteBucket", {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      publicReadAccess: false,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const originAccessIdentity = new OriginAccessIdentity(this, "OriginAccessIdentity");
    bucket.grantRead(originAccessIdentity);

    // CloudFront Function para adicionar index.html em subpastas
    const addIndexHtml = new CloudFrontFunction(this, "AddIndexHtmlFunction", {
      code: FunctionCode.fromInline(`
        function handler(event) {
          var request = event.request;
          var uri = request.uri;
          
          // Verifica se a URI não termina com extensão de arquivo
          var hasFileExtension = /\\.(html|js|css|json|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|xml|txt|pdf|zip)$/i.test(uri);
          
          // Se não tiver extensão e não terminar com index.html, adiciona /index.html
          if (!hasFileExtension && !uri.endsWith('/index.html')) {
            // Se terminar com /, adiciona index.html
            if (uri.endsWith('/')) {
              request.uri = uri + 'index.html';
            } else {
              // Caso contrário, adiciona /index.html
              request.uri = uri + '/index.html';
            }
          }
          
          return request;
        }
      `),
    });

    const distribution = new Distribution(this, "Distribution", {
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(bucket, {
          originAccessLevels: [AccessLevel.READ, AccessLevel.WRITE],
        }),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        functionAssociations: [
          {
            function: addIndexHtml,
            eventType: FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
      defaultRootObject: "index.html",
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: Duration.seconds(0),
        },
      ],
    });

    new BucketDeployment(this, "WebsiteBucketDeployment", {
      destinationBucket: bucket,
      sources: [Source.asset(join(__dirname, "public"))],
      distribution,
      distributionPaths: [
        "/tutorials/*",
        "/pt-br/*",
        "/en/*",
        "/authors/*",
        "/categories/*",
        "/series/*",
        "/tags/*",
      ],
      memoryLimit: 1024,
    });


    // const certificateArn = "arn:aws:acm:us-east-1:549672552044:certificate/350b4440-4bcd-4cb0-97c8-076dcf6a502b";
    // const certificate=Certificate.fromCertificateArn(this, "DomainCertificate", certificateArn);

    // // const recordName = "site";
    // const domainName = "marciocadev.com";
    // const aliasDomainNames = ["www.marciocadev.com"];

    // const distribution = new Distribution(this, "Distribution", {
    //   // certificate: certificate,
    //   defaultBehavior: {
    //     origin: S3BucketOrigin.withOriginAccessControl(bucket, {
    //       originAccessLevels: [AccessLevel.READ, AccessLevel.LIST]
    //     }),
    //   },
    //   // domainNames: [[domainName].join(".")],
    //   defaultRootObject: "index.html",
    //   errorResponses: [
    //     {
    //         httpStatus: 404,
    //         responseHttpStatus: 200,
    //         responsePagePath: '/index.html',
    //         ttl: Duration.seconds( 0 ),
    //     },
    //   ],
    // });

    // new BucketDeployment(this, "WebsiteBucketDeployment", {
    //   destinationBucket: bucket,
    //   sources: [Source.asset(join(__dirname, "..", "..", "marciocadev-website", "public"))],
    //   distribution,
    //   memoryLimit: 512
    // });

    // const cfOAI = new OriginAccessIdentity(this, "OriginAccessIdentity");

    // bucket.addToResourcePolicy(
    //   new PolicyStatement({
    //     actions: ["s3:GetObject"],
    //     resources: [bucket.arnForObjects("*")],
    //     principals: [
    //       new CanonicalUserPrincipal(cfOAI.cloudFrontOriginAccessIdentityS3CanonicalUserId)
    //     ]
    //   })
    // );

    // const hostedZoneId = "Z014672621L0K2RACEWVV";
    // const hostedZone = HostedZone.fromHostedZoneAttributes( this, 'HostedZone', {
    //   hostedZoneId: hostedZoneId,
    //   zoneName: domainName,
    // });

    // new ARecord( this, 'AliasRecord', {
    //   zone: hostedZone,
    //   target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
    // });

    // for (const alias of aliasDomainNames ?? [] ) {
    //   new ARecord(this, `AliasRecord-${alias}`, {
    //     zone: hostedZone,
    //     target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
    //     recordName: alias,
    //   });
    // };
  }
}
