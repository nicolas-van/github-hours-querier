
const Promise = require('bluebird');
const git = require('nodegit');
const _ = require('lodash');
const moment = require('moment');

const config = {
  // Maximum time diff between 2 subsequent commits in minutes which are
  // counted to be in the same coding "session"
  maxCommitDiffInMinutes: 60,

  // How many minutes should be added for the first commit of coding session
  firstCommitAdditionInMinutes: 30,

  // Include commits since time x
  since: 'always',
  until: 'always',

  // Include merge requests
  mergeRequest: true,

  // Aliases of emails for grouping the same activity as one person
  emailAliases: {
  },
  branch: null,
};


async function extractData(path) {
  return await getCommits(path, config.branch).then(function(commits) {
    const commitsByEmail = _.groupBy(commits, function(commit) {
      let email = commit.author.email || 'unknown';
      if (config.emailAliases !== undefined && config.emailAliases[email] !== undefined) {
        email = config.emailAliases[email];
      }
      return email;
    });

    const authorWorks = _.map(commitsByEmail, function(authorCommits, authorEmail) {
      return {
        email: authorEmail,
        name: authorCommits[0].author.name,
        hours: estimateHours(_.pluck(authorCommits, 'date')),
        commits: authorCommits.length,
      };
    });

    // XXX: This relies on the implementation detail that json is printed
    // in the same order as the keys were added. This is anyway just for
    // making the output easier to read, so it doesn't matter if it
    // isn't sorted in some cases.
    const sortedWork = {};

    _.each(_.sortBy(authorWorks, 'hours'), function(authorWork) {
      sortedWork[authorWork.email] = _.omit(authorWork, 'email');
    });

    const totalHours = _.reduce(sortedWork, function(sum, authorWork) {
      return sum + authorWork.hours;
    }, 0);

    sortedWork.total = {
      hours: totalHours,
      commits: commits.length,
    };

    return sortedWork.total.hours;
  });
}
module.exports.extractData = extractData;

// Estimates spent working hours based on commit dates
function estimateHours(dates) {
  // Oldest commit first, newest last
  const sortedDates = dates.sort(function(a, b) {
    return a - b;
  });
  let currentMinutes = config.firstCommitAdditionInMinutes;
  let lastDate = null;
  _.forEach(sortedDates, function(date) {
    if (lastDate === null) {
      lastDate = date;
      return;
    }
    const diffInMinutes = (date - lastDate) / 1000 / 60;
    if (diffInMinutes < config.maxCommitDiffInMinutes) {
      currentMinutes += diffInMinutes;
    } else {
      currentMinutes += Math.min(diffInMinutes, config.firstCommitAdditionInMinutes);
    }
    lastDate = date;
  });

  return currentMinutes / 60;
}

// Promisify nodegit's API of getting all commits in repository
function getCommits(gitPath, branch) {
  return git.Repository.open(gitPath)
    .then(function(repo) {
      const allReferences = getAllReferences(repo);
      let filterPromise;

      if (branch) {
        filterPromise = Promise.filter(allReferences, function(reference) {
          return (reference == ('refs/heads/' + branch));
        });
      } else {
        filterPromise = Promise.filter(allReferences, function(reference) {
          return reference.match(/refs\/heads\/.*/);
        });
      }

      return filterPromise.map(function(branchName) {
        return getBranchLatestCommit(repo, branchName);
      })
        .map(function(branchLatestCommit) {
          return getBranchCommits(branchLatestCommit);
        })
        .reduce(function(allCommits, branchCommits) {
          _.each(branchCommits, function(commit) {
            allCommits.push(commit);
          });

          return allCommits;
        }, [])
        .then(function(commits) {
          // Multiple branches might share commits, so take unique
          const uniqueCommits = _.uniq(commits, function(item) {
            return item.sha;
          });

          return uniqueCommits.filter(function(commit) {
            // Exclude all commits starting with "Merge ..."
            if (!config.mergeRequest && commit.message.startsWith('Merge ')) {
              return false;
            } else {
              return true;
            }
          });
        });
    });
}

function getAllReferences(repo) {
  return repo.getReferenceNames(git.Reference.TYPE.ALL);
}

function getBranchLatestCommit(repo, branchName) {
  return repo.getBranch(branchName).then(function(reference) {
    return repo.getBranchCommit(reference.name());
  });
}

function getBranchCommits(branchLatestCommit) {
  return new Promise(function(resolve, reject) {
    const history = branchLatestCommit.history();
    const commits = [];

    history.on('commit', function(commit) {
      let author = null;
      if (!_.isNull(commit.author())) {
        author = {
          name: commit.author().name(),
          email: commit.author().email(),
        };
      }

      const commitData = {
        sha: commit.sha(),
        date: commit.date(),
        message: commit.message(),
        author: author,
      };

      let isValidSince = true;
      const sinceAlways = config.since === 'always' || !config.since;
      if (sinceAlways || moment(commitData.date.toISOString()).isAfter(config.since)) {
        isValidSince = true;
      } else {
        isValidSince = false;
      }

      let isValidUntil = true;
      const untilAlways = config.until === 'always' || !config.until;
      if (untilAlways || moment(commitData.date.toISOString()).isBefore(config.until)) {
        isValidUntil = true;
      } else {
        isValidUntil = false;
      }

      if (isValidSince && isValidUntil) {
        commits.push(commitData);
      }
    });

    history.on('end', function() {
      resolve(commits);
    });

    history.on('error', function(err) {
      reject(err);
    });

    // Start emitting events.
    history.start();
  });
}
