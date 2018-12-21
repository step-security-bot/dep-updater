#!/usr/bin/env node
require("make-promises-safe");

// Require Node.js Dependencies
const { strictEqual } = require("assert").strict;
const { join } = require("path");
const { existsSync } = require("fs");

// Require Third-party Dependencies
const { gray, green, bold, yellow, cyan } = require("kleur");
const cross = require("cross-spawn");
const inquirer = require("inquirer");

// Require Internal Dependencies
const { parseOutDatedDependencies, taggedString } = require("../src/utils");
const questions = require("../src/questions.json");

// CONSTANTS
const STDIO = { stdio: "inherit" };

// VARIABLES
const gitTemplate = taggedString`"chore(package): update ${"name"} from ${"from"} to ${"to"}"`;

async function main() {
    console.log(`\n${gray(" > npm outdated --json")}`);
    const { stdout } = cross.sync("npm", ["outdated", "--json"]);
    const outdated = parseOutDatedDependencies(stdout);

    // Define list of packages to update!
    const packageToUpdate = [];
    for (const pkg of outdated) {
        if (pkg.current === pkg.latest) {
            continue;
        }

        const updateTo = pkg.wanted === pkg.current ? pkg.latest : pkg.wanted;
        console.log(`\n${bold(green(pkg.name))} (${yellow(pkg.current)} -> ${cyan(updateTo)})`);
        const { update } = await inquirer.prompt([questions.update_package]);
        if (!update) {
            continue;
        }

        pkg.updateTo = updateTo;
        if (pkg.wanted !== pkg.latest && pkg.current !== pkg.wanted) {
            const { release } = await inquirer.prompt([{
                type: "list",
                name: "release",
                choices: [
                    { name: `wanted (${yellow(pkg.wanted)})`, value: pkg.wanted },
                    { name: `latest (${yellow(pkg.latest)})`, value: pkg.latest }
                ],
                default: 0
            }]);

            pkg.updateTo = release;
        }

        packageToUpdate.push(pkg);
    }

    // Exit if there is no package to update
    if (packageToUpdate.length === 0) {
        console.log("\nNo package to update.. exiting process");
        process.exit(0);
    }

    // Configuration
    console.log(`\n${gray(" > Configuration")}\n`);
    const { runTest, gitCommit } = await inquirer.prompt([
        questions.run_test,
        questions.git_commit
    ]);

    // Verify test and git on the local root/system
    console.log(`\n${gray(" > Verify git, npm and test scripts")}\n`);
    if (gitCommit) {
        const { signal } = cross.sync("git", ["--version"]);

        strictEqual(signal, null, new Error("git command not found!"));
        console.log("👍 git executable is accessible");
    }

    if (runTest) {
        const { stdout } = cross.sync("npm", ["run", "--json"]);
        const scripts = JSON.parse(stdout.toString());

        strictEqual(Reflect.has(scripts, "test"), true, new Error("unable to found npm test script"));
        console.log("👍 npm test script must exist");
    }
    const hasPackageLock = existsSync(join(process.cwd(), "package-lock.json"));

    console.log(`\n${gray(" > Everything is okay ... Running update in one second.")}\n`);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Run updates!
    for (const pkg of packageToUpdate) {
        console.log(`\nupdating ${bold(green(pkg.name))} (${yellow(pkg.current)} -> ${cyan(pkg.updateTo)})`);
        if (pkg.updateTo === pkg.wanted) {
            console.log(` > npm update ${green(pkg.name)}`);
            cross.sync("npm", ["update", pkg.name]);
        }
        else {
            console.log(` > npm remove ${green(pkg.name)}`);
            cross.sync("npm", ["remove", pkg.name]);

            const completePackageName = `${green(pkg.name)}@${cyan(pkg.updateTo)}`;
            const installCMD = hasPackageLock ? "ci" : "install";
            console.log(` > npm ${installCMD} ${completePackageName}`);
            cross.sync("npm", [installCMD, completePackageName]);
        }

        if (runTest) {
            console.log(" > npm test");
            try {
                const { signal } = cross.sync("npm", ["test"], STDIO);
                strictEqual(signal, null);
            }
            catch (error) {
                console.error(error);
                // TODO: rollback!
            }
        }

        if (gitCommit) {
            const commitMsg = gitTemplate({ name: pkg.name, from: pkg.current, to: pkg.updateTo });
            console.log(` > git commit -m ${yellow(commitMsg)}`);

            cross.sync("git", ["add", "package.json"]);
            cross.sync("git", ["commit", "-m", commitMsg]);
        }
    }
}
main().catch(console.erorr);