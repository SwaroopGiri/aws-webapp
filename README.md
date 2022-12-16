# webapp
A collection of REST APIs built to be deployed over aws as a systemctl service. Includes CI/CD using github actions which triggers a new ami build on pull request using packer and updates autoscaling group with recent launch template version. Make sure to create IAM role for packer and attach required policies to it. Add respective github secrets wherever necessary.

## Frameworks

  Nodejs, Expressjs

## Cloning the Repo
```
  git clone git@github.com:swaroop-giri/webappPS.git
```

## Node Installation
```
  npm init
  npm install
```

## Running the Application
```
  Node app.js
```

## APIs
List of API calls supported by the application
### HealthCheck (GET)
```
  curl -I http://localhost:8000/healthz
```
### Create Account (POST)
Hit with a json object containing Username, Password, First_Name and Last_Name and make sure to copy the id from output
```
  http://localhost:8000/v1/account
```
### Update Account (PUT) [BasicAuth]
Use BasicAuth and hit with a json object containing Password, First_Name and Last_Name need to be updated
```
  http://{IP}:8000/v1/account/{id}
```
### Fetch Account Details (GET) [BasicAuth]
```
  http://{IP}:8000/v1/account/{id}
```
### Delete Account Details (DELETE) [BasicAuth]
```
  http://{IP}:8000/v1/account/{id}
```
### Add Document (POST) [BasicAuth]
```
  http://{IP}:8000/v1/documents
```
### Get Documents (GET) [BasicAuth]
Use BasicAuth to get all the documents uploaded by user
```
  http://{IP}:8000/v1/documents
```
### Fetch Document (GET) [BasicAuth]
```
  http://{IP}:8000/v1/documents/{id}
```
### Delete Document (DELETE) [BasicAuth]
```
  http://{IP}:8000/v1/documents/{id}
```
 
