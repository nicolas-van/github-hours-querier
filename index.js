
const axios = require("axios");
const utils = require('./utils');
const _ = require('lodash');
const fs = require('fs');

require('dotenv').config();

async function main() {
  try {
    await principal();
  } catch(e) {
    console.error(e);
  }
}

async function principal() {
  const wanted = require('./wanted.json');
  const results = require('./results.json');
  const toFetch = _.filter(wanted, (w) => {
    return ! _.contains(_.keys(results), w);
  });
  for (const repo of toFetch) {
    const info = await getAllRepoInfo(repo);
    results[repo] = info;
    fs.writeFileSync('./results.json', JSON.stringify(results, null, 2));
  }
}

async function getAllRepoInfo(repo) {
  const headers = process.env.GITHUB_TOKEN ? {
    'Authorization': `token ${process.env.GITHUB_TOKEN}`
  }: {};
  const repoInfo = (await axios({
    method: 'get',
    url: `https://api.github.com/repos/${repo}`,
    headers: headers,
  })).data;

  const branchInfo = (await axios({
    method: 'post',
    url: 'https://api.github.com/graphql',
    headers: headers,
    data: {
      query: `
      {
        repo: repository(owner: "${repo.split('/')[0]}", name: "${repo.split('/')[1]}") {
          nameWithOwner
          createdAt
          issues(first: 0) {
            totalCount
          }
          pullRequests(first: 0) {
            totalCount
          }
          releases(first: 0) {
            totalCount
          }
          stargazers(first: 0) {
            totalCount
          }
          repositoryTopics(first: 0) {
            totalCount
          }
          registryPackages(first: 0) {
            totalCount
          }
          watchers(first:0) {
            totalCount
          }
          projects(first: 0) {
            totalCount
          }
          milestones(first:0) {
            totalCount
          }
          mentionableUsers(first: 0) {
            totalCount
          }
          languages(first: 0) {
            totalCount
          }
          labels(first: 0) {
            totalCount
          }
          forks(first: 0) {
            totalCount
          }
          deployments(first: 0) {
            totalCount
          }
          commitComments(first: 0) {
            totalCount
          }
          assignableUsers(first: 0) {
            totalCount
          }
          defaultBranchRef {
            name
            target {
              ... on Commit {
                id
                history(first: 0) {
                  totalCount
                }
              }
            }
          }
        }
      }
      `
    }
  })).data;

  return {
    repoInfo,
    branchInfo,
  };
}

main();
