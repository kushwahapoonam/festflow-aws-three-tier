# Offline initial resource preview

A local SAM translation produced this native resource inventory for the first create. Get the actual AWS change set ARN by running the plan commands in [Milestone 2](02-deploy.md).

| CloudFormation resource type | Default create count | Optional count |
| --- | ---: | ---: |
| `AWS::ApiGatewayV2::Api` | 1 | 0 |
| `AWS::ApiGatewayV2::Stage` | 1 | 0 |
| `AWS::CloudFront::CachePolicy` | 1 | 0 |
| `AWS::CloudFront::Distribution` | 1 | 0 |
| `AWS::CloudFront::Function` | 1 | 0 |
| `AWS::CloudFront::OriginAccessControl` | 1 | 0 |
| `AWS::CloudWatch::Alarm` | 0 | 1 |
| `AWS::Cognito::UserPool` | 1 | 0 |
| `AWS::Cognito::UserPoolClient` | 1 | 0 |
| `AWS::Cognito::UserPoolDomain` | 1 | 0 |
| `AWS::Cognito::UserPoolGroup` | 3 | 0 |
| `AWS::DynamoDB::Table` | 1 | 0 |
| `AWS::Events::Rule` | 1 | 0 |
| `AWS::IAM::Role` | 3 | 0 |
| `AWS::Lambda::EventSourceMapping` | 1 | 0 |
| `AWS::Lambda::Function` | 3 | 0 |
| `AWS::Lambda::Permission` | 18 | 0 |
| `AWS::Logs::LogGroup` | 4 | 0 |
| `AWS::Route53::RecordSetGroup` | 0 | 1 |
| `AWS::S3::Bucket` | 2 | 0 |
| `AWS::S3::BucketPolicy` | 2 | 0 |
| `AWS::SQS::Queue` | 2 | 0 |

The default excludes optional alarm and alias resources. It uses the Cognito test callback until the second change set.
