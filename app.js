#!/usr/bin/env node

const { execSync, spawn } = require("child_process");
const inquirer = require("inquirer");
const fs = require("fs");
const path = require("path");

const cyan = "\x1b[36m";
const green = "\x1b[32m";
const red = "\x1b[31m";
const yellow = "\x1b[33m";
const dim = "\x1b[2m";
const bold = "\x1b[1m";
const reset = "\x1b[0m";

function log(icon, msg) {
  console.log(`  ${icon} ${msg}`);
}

function run(cmd, cwd) {
  return execSync(cmd, { cwd, encoding: "utf-8" }).trim();
}

function runSilent(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

function pickFolder() {
  const script = `
    tell application "Finder"
      set theFolder to choose folder with prompt "Select your project folder"
      return POSIX path of theFolder
    end tell
  `;
  try {
    return execSync(`osascript -e '${script}'`, {
      encoding: "utf-8",
    }).trim();
  } catch {
    return null;
  }
}

function printBanner() {
  console.log("");
  console.log(`${cyan}${bold}  ╔══════════════════════════════════╗`);
  console.log(`  ║       GitHub Manager             ║`);
  console.log(`  ╚══════════════════════════════════╝${reset}`);
  console.log("");
}

async function checkGitHubCLI() {
  const ghPath = runSilent("which gh");
  if (ghPath) return true;

  log("⚠️", `${yellow}GitHub CLI (gh) is not installed.${reset}`);
  console.log("");

  const { install } = await inquirer.prompt([
    {
      type: "confirm",
      name: "install",
      message: "Install it now with Homebrew?",
      default: true,
    },
  ]);

  if (!install) {
    log("❌", `${red}GitHub CLI is required. Install manually:${reset}`);
    console.log(`  ${dim}brew install gh${reset}`);
    console.log("");
    return false;
  }

  log("📦", `${dim}Installing GitHub CLI...${reset}`);
  try {
    run("brew install gh");
    log("✅", `${green}GitHub CLI installed!${reset}`);
    console.log("");
    return true;
  } catch {
    log("❌", `${red}Install failed. Run manually:${reset}`);
    console.log(`  ${dim}brew install gh${reset}`);
    console.log("");
    return false;
  }
}

async function checkAuth() {
  const user = runSilent("gh auth status 2>&1");
  if (user && user.includes("Logged in")) return true;

  log("⚠️", `${yellow}Not logged in to GitHub.${reset}`);
  console.log("");

  const { login } = await inquirer.prompt([
    {
      type: "confirm",
      name: "login",
      message: "Log in to GitHub now?",
      default: true,
    },
  ]);

  if (!login) {
    log("❌", `${red}Login required. Run manually:${reset}`);
    console.log(`  ${dim}gh auth login${reset}`);
    console.log("");
    return false;
  }

  log("🔐", `${dim}Starting GitHub login...${reset}`);
  console.log("");
  log("💡", `${yellow}A browser window will open. If not, paste the URL shown below.${reset}`);
  console.log("");

  try {
    const child = spawn(
      "gh", ["auth", "login", "-p", "https", "-h", "GitHub.com", "-w"],
      { stdio: "inherit" }
    );
    await new Promise((resolve, reject) => {
      child.on("close", (code) => code === 0 ? resolve() : reject(new Error("Login failed")));
    });
    log("✅", `${green}Logged in!${reset}`);
    console.log("");
    return true;
  } catch {
    log("❌", `${red}Login failed. Run this manually in your terminal:${reset}`);
    console.log(`  ${dim}gh auth login${reset}`);
    console.log("");
    return false;
  }
}

// ─── FEATURE: Browse Repos ─────────────────────────────────────────────────

async function browseRepos() {
  let page = 1;
  const perPage = 20;

  while (true) {
    log("📋", `${bold}Your Repositories (page ${page})${reset}`);
    console.log("");

    const json = runSilent(
      `gh repo list --limit ${perPage} --json name,owner,description,isPrivate,stargazerCount,updatedAt,primaryLanguage,url --jq '.[] | {name: .name, owner: .owner.login, desc: .description, private: .isPrivate, stars: .stargazerCount, updated: .updatedAt, lang: .primaryLanguage.name, url: .url}'`
    );

    if (!json) {
      log("❌", `${red}Failed to fetch repos. Are you logged in?${reset}`);
      console.log("");
      return;
    }

    const lines = json.split("\n").filter(Boolean);
    const repos = lines.map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean);

    if (repos.length === 0) {
      log("ℹ️", `${yellow}No repos found.${reset}`);
      console.log("");
      return;
    }

    const choices = repos.map((r) => ({
      name: `${r.private ? "🔒" : "🌐"} ${r.owner}/${r.name} ${r.stars > 0 ? `⭐ ${r.stars}` : ""} ${r.desc ? dim + "- " + r.desc.slice(0, 40) + reset : ""}`,
      value: r,
    }));

    choices.push({ name: `${dim}Load more...${reset}`, value: "load_more" });
    choices.push({ name: `${dim}Back to menu${reset}`, value: "back" });

    const { selected } = await inquirer.prompt([
      {
        type: "list",
        name: "selected",
        message: "Select a repo:",
        choices,
        pageSize: 25,
      },
    ]);

    if (selected === "back") return;
    if (selected === "load_more") {
      page++;
      continue;
    }

    await showRepoDetails(selected.url);
  }
}

// ─── FEATURE: Repo Details ─────────────────────────────────────────────────

async function showRepoDetails(repoUrl) {
  const repoSlug = repoUrl.replace("https://github.com/", "");

  log("🔍", `${bold}Fetching details for ${repoSlug}...${reset}`);
  console.log("");

  const json = runSilent(`gh repo view ${repoSlug} --json name,description,isPrivate,stargazerCount,forkCount,watchers,issues,pullRequests,primaryLanguage,defaultBranchRef,createdAt,updatedAt,url,repositoryTopics`);

  if (!json) {
    log("❌", `${red}Failed to fetch repo details.${reset}`);
    console.log("");
    return;
  }

  const repo = JSON.parse(json);

  console.log(`  ${bold}${cyan}${repo.name}${reset} ${repo.isPrivate ? "🔒 Private" : "🌐 Public"}`);
  if (repo.description) console.log(`  ${repo.description}`);
  console.log("");
  console.log(`  ${yellow}⭐ Stars:${reset}      ${repo.stargazerCount}`);
  console.log(`  ${yellow}🍴 Forks:${reset}      ${repo.forkCount}`);
  console.log(`  ${yellow}👀 Watchers:${reset}   ${repo.watchers?.totalCount || 0}`);
  console.log(`  ${yellow}📋 Issues:${reset}     ${repo.issues?.totalCount || 0} open`);
  console.log(`  ${yellow}🔀 PRs:${reset}        ${repo.pullRequests?.totalCount || 0} open`);
  if (repo.primaryLanguage) console.log(`  ${yellow}💻 Language:${reset}   ${repo.primaryLanguage.name}`);
  console.log(`  ${yellow}🌿 Branch:${reset}     ${repo.defaultBranchRef?.name || "main"}`);
  console.log(`  ${yellow}📅 Created:${reset}    ${repo.createdAt}`);
  console.log(`  ${yellow}🔄 Updated:${reset}    ${repo.updatedAt}`);
  if (repo.repositoryTopics?.nodes?.length > 0) {
    console.log(`  ${yellow}🏷️  Topics:${reset}    ${repo.repositoryTopics.nodes.map((t) => t.topic.name).join(", ")}`);
  }
  console.log(`  ${yellow}🔗 URL:${reset}        ${repo.url}`);
  console.log("");
}

async function repoDetailsMenu() {
  const repos = await fetchAllRepos();
  if (!repos) return;

  const { selected } = await inquirer.prompt([
    {
      type: "list",
      name: "selected",
      message: "Select a repo to view:",
      choices: repos.map((r) => ({
        name: `${r.private ? "🔒" : "🌐"} ${r.name}`,
        value: r.url,
      })),
    },
  ]);

  await showRepoDetails(selected);
}

async function fetchAllRepos() {
  const json = runSilent(
    `gh repo list --limit 100 --json name,owner,isPrivate,url --jq '.[] | {name: .name, owner: .owner.login, private: .isPrivate, url: .url}'`
  );

  if (!json) {
    log("❌", `${red}Failed to fetch repos.${reset}`);
    console.log("");
    return null;
  }

  const lines = json.split("\n").filter(Boolean);
  return lines.map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

async function pickRepo(message) {
  const repos = await fetchAllRepos();
  if (!repos) return null;

  const { selected } = await inquirer.prompt([
    {
      type: "list",
      name: "selected",
      message,
      choices: repos.map((r) => ({
        name: `${r.private ? "🔒" : "🌐"} ${r.owner}/${r.name}`,
        value: r,
      })),
      pageSize: 20,
    },
  ]);

  return selected;
}

// ─── FEATURE: Create Repo ──────────────────────────────────────────────────

async function createRepo() {
  log("🆕", `${bold}Create a New Repository${reset}`);
  console.log("");

  const { name } = await inquirer.prompt([
    {
      type: "input",
      name: "name",
      message: "Repository name:",
      validate: (v) => (v.trim() ? true : "Name is required"),
    },
  ]);

  const { description } = await inquirer.prompt([
    {
      type: "input",
      name: "description",
      message: "Description (optional):",
    },
  ]);

  const { visibility } = await inquirer.prompt([
    {
      type: "list",
      name: "visibility",
      message: "Visibility:",
      choices: [
        { name: "Public  (anyone can see it)", value: "public" },
        { name: "Private (only you can see it)", value: "private" },
      ],
    },
  ]);

  const { addReadme } = await inquirer.prompt([
    {
      type: "confirm",
      name: "addReadme",
      message: "Add a README file?",
      default: true,
    },
  ]);

  console.log("");
  log("🚀", `${bold}Creating repository...${reset}`);

  try {
    let cmd = `gh repo create ${name} --${visibility}`;
    if (description) cmd += ` --description "${description}"`;
    if (addReadme) cmd += " --clone";

    run(cmd);
    log("✅", `${green}Repository created!${reset}`);
    console.log(`  ${cyan}https://github.com/${name}${reset}`);
    console.log("");
  } catch (error) {
    log("❌", `${red}Failed: ${error.message}${reset}`);
    console.log("");
  }
}

// ─── FEATURE: Connect Local Folder ─────────────────────────────────────────

async function connectLocal() {
  log("📂", `${dim}Opening folder picker...${reset}`);
  const folderPath = pickFolder();

  if (!folderPath) {
    log("❌", `${red}No folder selected. Exiting.${reset}`);
    console.log("");
    return;
  }

  const projectDir = folderPath.replace(/\/$/, "");
  const folderName = path.basename(projectDir);

  log("✅", `${green}Selected:${reset} ${projectDir}`);
  console.log("");

  const hasGit = fs.existsSync(path.join(projectDir, ".git"));

  const { username } = await inquirer.prompt([
    {
      type: "input",
      name: "username",
      message: "GitHub username:",
      validate: (v) => (v.trim() ? true : "Username is required"),
    },
  ]);

  const { repoName } = await inquirer.prompt([
    {
      type: "input",
      name: "repoName",
      message: "Repo name:",
      default: folderName,
      validate: (v) => (v.trim() ? true : "Repo name is required"),
    },
  ]);

  const { repoExists } = await inquirer.prompt([
    {
      type: "confirm",
      name: "repoExists",
      message: "Does this repo already exist on GitHub?",
      default: false,
    },
  ]);

  const { visibility } = await inquirer.prompt([
    {
      type: "list",
      name: "visibility",
      message: "Visibility:",
      choices: [
        { name: "Public  (anyone can see it)", value: "public" },
        { name: "Private (only you can see it)", value: "private" },
      ],
    },
  ]);

  console.log("");
  log("🚀", `${bold}Connecting to GitHub...${reset}`);
  console.log("");

  try {
    if (!hasGit) {
      log("1️⃣", "Initializing git...");
      run("git init", projectDir);
      log("✅", `${green}Git initialized${reset}`);
    } else {
      log("1️⃣", `${dim}Git already initialized, skipping${reset}`);
    }

    log("2️⃣", "Adding files...");
    run("git add .", projectDir);
    log("✅", `${green}Files added${reset}`);

    log("3️⃣", "Creating commit...");
    try {
      run('git commit -m "Initial commit"', projectDir);
      log("✅", `${green}Commit created${reset}`);
    } catch {
      log("ℹ️", `${yellow}Nothing to commit (already committed?)${reset}`);
    }

    if (!repoExists) {
      log("4️⃣", `Creating ${visibility} repo on GitHub...`);
      try { run("git remote remove origin", projectDir); } catch {}
      run(
        `gh repo create ${repoName} --${visibility} --source=. --remote=origin --push`,
        projectDir
      );
      log("✅", `${green}Repo created and pushed!${reset}`);
    } else {
      log("4️⃣", "Connecting to existing repo...");
      try {
        run("git remote remove origin", projectDir);
      } catch {}
      run(
        `git remote add origin https://github.com/${username}/${repoName}.git`,
        projectDir
      );
      log("✅", `${green}Remote added${reset}`);

      log("5️⃣", "Pushing to GitHub...");
      run("git push -u origin main", projectDir);
      log("✅", `${green}Pushed${reset}`);
    }

    console.log("");
    console.log(
      `  ${green}${bold}✓ Done!${reset} ${green}Your project is on GitHub:${reset}`
    );
    console.log(
      `  ${cyan}https://github.com/${username}/${repoName}${reset}`
    );
    console.log("");
  } catch (error) {
    console.log("");
    log("❌", `${red}Error: ${error.message}${reset}`);

    if (error.message.includes("not authenticated")) {
      console.log("");
      log("💡", `${yellow}Not logged in. Run:${reset}`);
      console.log(`  ${dim}gh auth login${reset}`);
    }

    console.log("");
  }
}

// ─── FEATURE: Clone Repo ───────────────────────────────────────────────────

async function cloneRepo() {
  log("📥", `${bold}Clone a Repository${reset}`);
  console.log("");

  const repo = await pickRepo("Select a repo to clone:");
  if (!repo) return;

  const defaultDir = path.join(process.env.HOME, "Documents", repo.name);

  const { dest } = await inquirer.prompt([
    {
      type: "input",
      name: "dest",
      message: "Clone to:",
      default: defaultDir,
    },
  ]);

  console.log("");
  log("📥", `${bold}Cloning ${repo.owner}/${repo.name}...${reset}`);

  try {
    run(`gh repo clone ${repo.owner}/${repo.name} "${dest}"`);
    log("✅", `${green}Cloned to:${reset} ${dest}`);
    console.log("");
  } catch (error) {
    log("❌", `${red}Failed: ${error.message}${reset}`);
    console.log("");
  }
}

// ─── FEATURE: Rename Repo ──────────────────────────────────────────────────

async function renameRepo() {
  log("✏️", `${bold}Rename a Repository${reset}`);
  console.log("");

  const repo = await pickRepo("Select a repo to rename:");
  if (!repo) return;

  const { newName } = await inquirer.prompt([
    {
      type: "input",
      name: "newName",
      message: `New name for ${repo.name}:`,
      default: repo.name,
      validate: (v) => (v.trim() ? true : "Name is required"),
    },
  ]);

  if (newName === repo.name) {
    log("ℹ️", `${yellow}Name unchanged, skipping.${reset}`);
    console.log("");
    return;
  }

  const { confirm } = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirm",
      message: `Rename ${repo.owner}/${repo.name} → ${repo.owner}/${newName}?`,
      default: false,
    },
  ]);

  if (!confirm) {
    log("ℹ️", `${yellow}Cancelled.${reset}`);
    console.log("");
    return;
  }

  console.log("");
  log("✏️", `${bold}Renaming...${reset}`);

  try {
    run(`gh repo rename ${newName} ${repo.owner}/${repo.name}`);
    log("✅", `${green}Renamed to ${newName}!${reset}`);
    console.log(`  ${cyan}https://github.com/${repo.owner}/${newName}${reset}`);
    console.log("");
  } catch (error) {
    log("❌", `${red}Failed: ${error.message}${reset}`);
    console.log("");
  }
}

// ─── FEATURE: Delete Repo ──────────────────────────────────────────────────

async function deleteRepo() {
  log("🗑️", `${bold}Delete a Repository${reset}`);
  console.log("");
  log("⚠️", `${yellow}This action cannot be undone!${reset}`);
  console.log("");

  const repos = await fetchAllRepos();
  if (!repos) return;

  const { selected } = await inquirer.prompt([
    {
      type: "list",
      name: "selected",
      message: "Select a repo to DELETE:",
      choices: [
        ...repos.map((r) => ({
          name: `${r.private ? "🔒" : "🌐"} ${r.owner}/${r.name}`,
          value: r,
        })),
        { name: `${dim}Back to menu${reset}`, value: "back" },
      ],
      pageSize: 20,
    },
  ]);

  if (selected === "back") return;

  const { typedDelete } = await inquirer.prompt([
    {
      type: "input",
      name: "typedDelete",
      message: `Type "delete" to confirm deleting ${selected.owner}/${selected.name}:`,
      validate: (v) => v === "delete" ? true : 'Must type "delete"',
    },
  ]);

  console.log("");
  log("🗑️", `${bold}Deleting ${selected.owner}/${selected.name}...${reset}`);

  try {
    run(`gh repo delete ${selected.owner}/${selected.name} --yes`);
    log("✅", `${green}Deleted!${reset}`);
    console.log("");
  } catch (error) {
    if (error.message.includes("delete_repo")) {
      log("🔑", `${yellow}Missing delete permission. Requesting access...${reset}`);
      console.log("");
      try {
        const child = spawn(
          "gh", ["auth", "refresh", "-h", "github.com", "-s", "delete_repo"],
          { stdio: "inherit" }
        );
        await new Promise((resolve, reject) => {
          child.on("close", (code) => code === 0 ? resolve() : reject(new Error("Auth refresh failed")));
        });
        console.log("");
        log("🗑️", `${bold}Retrying deletion...${reset}`);
        run(`gh repo delete ${selected.owner}/${selected.name} --yes`);
        log("✅", `${green}Deleted!${reset}`);
        console.log("");
      } catch {
        log("❌", `${red}Permission denied or refresh failed. Try again later.${reset}`);
        console.log("");
      }
    } else {
      log("❌", `${red}Failed: ${error.message}${reset}`);
      console.log("");
    }
  }
}

// ─── FEATURE: Fork Repo ────────────────────────────────────────────────────

async function forkRepo() {
  log("🍴", `${bold}Fork a Repository${reset}`);
  console.log("");

  const repo = await pickRepo("Select a repo to fork:");
  if (!repo) return;

  console.log("");
  log("🍴", `${bold}Forking ${repo.owner}/${repo.name}...${reset}`);

  try {
    run(`gh repo fork ${repo.owner}/${repo.name} --clone=false`);
    log("✅", `${green}Forked to your account!${reset}`);
    console.log(`  ${cyan}https://github.com/${repo.name}${reset}`);
    console.log("");
  } catch (error) {
    log("❌", `${red}Failed: ${error.message}${reset}`);
    console.log("");
  }
}

// ─── MAIN MENU ─────────────────────────────────────────────────────────────

async function main() {
  printBanner();

  const hasGH = await checkGitHubCLI();
  if (!hasGH) process.exit(1);

  const authed = await checkAuth();
  if (!authed) process.exit(1);

  while (true) {
    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: "What would you like to do?",
        choices: [
          { name: "📋  Browse Repos", value: "browse" },
          { name: "🔍  View Repo Details", value: "details" },
          { name: "🆕  Create Repo", value: "create" },
          { name: "📂  Connect Local Folder", value: "connect" },
          { name: "📥  Clone Repo", value: "clone" },
          { name: "✏️   Rename Repo", value: "rename" },
          { name: "🗑️   Delete Repo", value: "delete" },
          { name: "🍴  Fork Repo", value: "fork" },
          { name: "🚪  Exit", value: "exit" },
        ],
        pageSize: 12,
      },
    ]);

    console.log("");

    switch (action) {
      case "browse":    await browseRepos(); break;
      case "details":   await repoDetailsMenu(); break;
      case "create":    await createRepo(); break;
      case "connect":   await connectLocal(); break;
      case "clone":     await cloneRepo(); break;
      case "rename":    await renameRepo(); break;
      case "delete":    await deleteRepo(); break;
      case "fork":      await forkRepo(); break;
      case "exit":
        log("👋", `${green}Goodbye!${reset}`);
        console.log("");
        process.exit(0);
    }
  }
}

main();
