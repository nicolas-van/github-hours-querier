#!/usr/bin/env node

const Promise = require('bluebird');
const git = require('nodegit');
const program = require('commander');
const _ = require('lodash');
const moment = require('moment');
const fs = require('fs');

var DATE_FORMAT = 'YYYY-MM-DD';

let config = {
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

  // Git repo
  gitPath: '.',

  // Aliases of emails for grouping the same activity as one person
  emailAliases: {
    'linus@torvalds.com': 'linus@linux.com',
  },
  branch: null,
};

function main() {
  exitIfShallow();

  parseArgs();
  config = mergeDefaultsWithArgs(config);
  config.since = parseSinceDate(config.since);
  config.until = parseUntilDate(config.until);

  // Poor man`s multiple args support
  // https://github.com/tj/commander.js/issues/531
  for (let i = 0; i < process.argv.length; i++) {
    const k = process.argv[i];
    let n = i <= process.argv.length - 1 ? process.argv[i + 1] : undefined;
    if (k == '-e' || k == '--email') {
      parseEmailAlias(n);
    } else
    if (k.startsWith('--email=')) {
      n = k.substring(k.indexOf('=') + 1);
      parseEmailAlias(n);
    }
  }

  getCommits(config.gitPath, config.branch).then(function(commits) {
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

    console.log(JSON.stringify(sortedWork, undefined, 2));
  }).catch(function(e) {
    console.error(e.stack);
  });
}

function exitIfShallow() {
  if (fs.existsSync('.git/shallow')) {
    console.error('Cannot analyze shallow copies!');
    console.error('Please run git fetch --unshallow before continuing!');
    process.exit(1);
  }
}

function parseArgs() {
  function int(val) {
    return parseInt(val, 10);
  }

  program
    .version(require('../package.json').version)
    .usage('[options]')
    .option(
      '-d, --max-commit-diff [max-commit-diff]',
      'maximum difference in minutes between commits counted to one' +
            ' session. Default: ' + config.maxCommitDiffInMinutes,
      int
    )
    .option(
      '-a, --first-commit-add [first-commit-add]',
      'how many minutes first commit of session should add to total.' +
            ' Default: ' + config.firstCommitAdditionInMinutes,
      int
    )
    .option(
      '-s, --since [since-certain-date]',
      'Analyze data since certain date.' +
            ' [always|yesterday|today|lastweek|thisweek|yyyy-mm-dd] Default: ' + config.since,
      String
    )
    .option(
      '-e, --email [emailOther=emailMain]',
      'Group person by email address.' +
            ' Default: none',
      String
    )
    .option(
      '-u, --until [until-certain-date]',
      'Analyze data until certain date.' +
            ' [always|yesterday|today|lastweek|thisweek|yyyy-mm-dd] Default: ' + config.until,
      String
    )
    .option(
      '-m, --merge-request [false|true]',
      'Include merge requests into calculation. ' +
            ' Default: ' + config.mergeRequest,
      String
    )
    .option(
      '-p, --path [git-repo]',
      'Git repository to analyze.' +
            ' Default: ' + config.gitPath,
      String
    )
    .option(
      '-b, --branch [branch-name]',
      'Analyze only data on the specified branch. Default: ' + config.branch,
      String
    );

  program.on('--help', function() {
    console.log('  Examples:');
    console.log('');
    console.log('   - Estimate hours of project');
    console.log('');
    console.log('       $ git hours');
    console.log('');
    console.log('   - Estimate hours in repository where developers commit' +
                    ' more seldom: they might have 4h(240min) pause between commits');
    console.log('');
    console.log('       $ git hours --max-commit-diff 240');
    console.log('');
    console.log('   - Estimate hours in repository where developer works 5' +
                    ' hours before first commit in day');
    console.log('');
    console.log('       $ git hours --first-commit-add 300');
    console.log('');
    console.log('   - Estimate hours work in repository since yesterday');
    console.log('');
    console.log('       $ git hours --since yesterday');
    console.log('');
    console.log('   - Estimate hours work in repository since 2015-01-31');
    console.log('');
    console.log('       $ git hours --since 2015-01-31');
    console.log('');
    console.log('   - Estimate hours work in repository on the "master" branch');
    console.log('');
    console.log('       $ git hours --branch master');
    console.log('');
    console.log('  For more details, visit https://github.com/kimmobrunfeldt/git-hours');
    console.log('');
  });

  program.parse(process.argv);
}

function parseInputDate(inputDate) {
  switch (inputDate) {
  case 'today':
    return moment().startOf('day');
  case 'yesterday':
    return moment().startOf('day').subtract(1, 'day');
  case 'thisweek':
    return moment().startOf('week');
  case 'lastweek':
    return moment().startOf('week').subtract(1, 'week');
  case 'always':
    return 'always';
  default:
    // XXX: Moment tries to parse anything, results might be weird
    return moment(inputDate, DATE_FORMAT);
  }
}

function parseSinceDate(since) {
  return parseInputDate(since);
}

function parseUntilDate(until) {
  return parseInputDate(until);
}

function parseEmailAlias(alias) {
  if (alias.indexOf('=') > 0) {
    const email = alias.substring(0, alias.indexOf('=')).trim();
    alias = alias.substring(alias.indexOf('=') + 1).trim();
    // console.warn("Adding alias " + email + " -> " + alias);
    if (config.emailAliases === undefined) {
      config.emailAliases = {};
    }
    config.emailAliases[email] = alias;
  } else {
    console.error('ERROR: Invalid alias: ' + alias);
  }
}

function mergeDefaultsWithArgs(conf) {
  return {
    range: program.range,
    maxCommitDiffInMinutes: program.maxCommitDiff || conf.maxCommitDiffInMinutes,
    firstCommitAdditionInMinutes: program.firstCommitAdd || conf.firstCommitAdditionInMinutes,
    since: program.since || conf.since,
    until: program.until || conf.until,
    gitPath: program.path || conf.gitPath,
    mergeRequest: program.mergeRequest !== undefined ? (program.mergeRequest == 'true') :
      conf.mergeRequest,
    branch: program.branch || conf.branch,
  };
}

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

main();
