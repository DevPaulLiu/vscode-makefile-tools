// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

// Makefile Tools Extension tests without sources and makefiles.
// These tests take advantage of the possibility of parsing
// a previously created dry-run 'make' output log.
// Each tested operation produces logging in the 'Makefile Tools'
// output channel and also in a log file on disk (defined via settings),
// which is compared with a baseline.

// TODO: add a suite of tests operating on real stand-alone makefile repos,
// thus emulating more closely the Makefile Tools end to end usage scenarios.
// For this we need to refactor the make process spawning in the extension,
// so that these tests would produce a deterministic output.

// Thus, this suite is not able to test the entire functionality of the extension
// (anything that is related to a real invocation of the make tool is not yet supported),
// but the remaining scenarios represent an acceptable amount of testing coverage.
// For this suite, even if only parsing is involved, it cannot run any test on any platform
// because of differences in path processing, extension naming, CppTools defaults (sdk, standard),
// debugger settings, etc...
// TODO: figure out a way to test correctly any test on any platform
// (possibly define a property to be considered when querying for process.platform).

// Some of these tests need also some fake binaries being checked in
// (enough to pass an 'if exists' check), to cover the identification of launch binaries
// that are called with arguments in the makefile.
// See comment in parser.ts, parseLineAsTool and parseLaunchConfiguration.

import * as configuration from "../../configuration";
import * as logger from "../../logger";
import { expect } from "chai";
import * as launch from "../../launch";
import * as make from "../../make";
import * as util from "../../util";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { extension } from "../../extension";
import { assert, log } from "console";
import { showOutputChannel } from "src/logger";


// TODO: refactor initialization and cleanup of each test
suite("MakeFile Tools Testing", () => {
  suiteSetup(async function (this: Mocha.Context) {
    this.timeout(100000);
    await vscode.commands.executeCommand("makefile.resetState", false);
  });

  setup(async function (this: Mocha.Context) {
    this.timeout(100000);
    await vscode.commands.executeCommand("makefile.resetState", false);
    await vscode.commands.executeCommand('workbench.extensions.installExtension', 'ms-vscode.cpptools');
  });

  // Interesting scenarios with string paths, corner cases in defining includes/defines,
  // complex configurations-targets-files associations.
  // For now, this test needs to run in an environment with VS 2019.
  // The output log varies depending on finding a particular VS toolset or not.
  // We need to test the scenario of providing in the makefile a full path to the compiler,
  // so there is no way around this. Using only compiler name and relying on path is not sufficient.
  // Also, for the cases when a path (relative or full) is given to the compiler in the makefile
  // and the compiler is not found there, the parser will skip over the compiler command
  // (see comment in parser.ts - parseLineAsTool), so again, we need to find the toolset that is referenced in the makefile.
  // TODO: mock various scenarios of VS environments without depending on what is installed.
  // TODO: adapt the makefile on mac/linux/mingw and add new tests in this suite
  // to parse the dry-run logs obtained on those platforms.
  let systemPlatform: string;
  if (process.platform === "win32") {
    systemPlatform =
      process.env.MSYSTEM === undefined ? "win32" : process.env.MSYSTEM;
  } else {
    systemPlatform = process.platform;
  }

  vscode.extensions.getExtension("ms-vscode.makefile-tools")?.activate();
  vscode.extensions.getExtension("ms-vscode.cpptools")?.activate();
  
  test(`Prepare Test Project`, async () => {
    await vscode.commands.executeCommand("makefile.resetState", false);
    await vscode.commands.executeCommand('workbench.extensions.installExtension', 'ms-vscode.cpptools');
    console.log("Set makefile extension output folder to .vscode");
    await vscode.workspace
    .getConfiguration("makefile")
    .update("extensionOutputFolder", ".vscode");

    console.log("Update makefile content");
    let makefilePath = vscode.Uri.file(path.resolve(util.getWorkspaceRoot() + "/Makefile"));
    let document = await vscode.workspace.openTextDocument(makefilePath);
    let editor = await vscode.window.showTextDocument(document);
    await editor.edit(editBuilder => {
      editBuilder.replace(new vscode.Range(new vscode.Position(2, 0), new vscode.Position(4,0)), 
     `SRCS = src/main.cpp src/mod/mod.cpp\nHEADS = include/main.h include/mod/mod.h\n`);
    });

    console.log("Run makefile.configure");
    await vscode.commands.executeCommand("makefile.configure");
    // await new Promise(resolve => setTimeout(resolve, 5000));

    console.log("check if makefile is configured successfully");
    let dryRunLogPath = util.getWorkspaceRoot() + "/.vscode" + "/dryrun.log"
    const data = await fs.promises.readFile(dryRunLogPath, "utf8");
    expect(data.toString()).contains("make: Leaving directory");
  });

  test(`Core Scenario - ${systemPlatform}`, async () => {
    console.log("Set the build target to 'all'.");
    await vscode.commands.executeCommand("makefile.setTargetByName", "all");
    expect(await vscode.commands.executeCommand("makefile.getBuildTarget")).eq("all");
    
    // Set the launch configuration to 'app'.
    console.log("Set the launch configuration to 'app'.");
    let launchConfig = util.getWorkspaceRoot() + ">" + "app()";
    await vscode.commands.executeCommand("makefile.setLaunchConfigurationByName", launchConfig);

    // Verify Launch Configuration.
    console.log("Verify Launch Configuration.");
    let launchConfiguration = JSON.stringify(await vscode.commands.executeCommand("makefile.getCurrentLaunchConfiguration"));
    const config = JSON.parse(launchConfiguration);
    expect(config.binaryPath).to.equal("c:\\Users\\v-paliu\\Desktop\\makefile-example\\app");

    // Build and Verify results.
    console.log("Build and Verify results.");
    expect(await vscode.commands.executeCommand("makefile.buildTarget")).to.be.eq(0);
    await new Promise(resolve => setTimeout(resolve, 5000));

    // verify target executed successfully..
    console.log("Run makefile.launchRun");
    await vscode.commands.executeCommand("makefile.launchRun");

    // Set breakpoint at line 4.
    console.log("Set breakpoint at line 4.");
    let codeFilePath = vscode.Uri.file(path.resolve(util.getWorkspaceRoot()+"/src/mod/mod.cpp"));
    const breakpoint = new vscode.SourceBreakpoint(new vscode.Location(codeFilePath, new vscode.Position(3, 0)));
    await vscode.debug.addBreakpoints([breakpoint]);

    // Update debug settings.
    console.log("Update debug settings to use gdb.");
    codeFilePath = vscode.Uri.file(path.resolve(util.getWorkspaceRoot()+"/.vscode/settings.json"));
    let document = await vscode.workspace.openTextDocument(codeFilePath);
    let editor = await vscode.window.showTextDocument(document);
    await editor.insertSnippet(new vscode.SnippetString(`, \n"MIMode": "gdb",\n"miDebuggerPath": "C:\\\\\\\\msys64\\\\\\\\mingw64\\\\\\\\bin"`), new vscode.Position(6, 29));
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log("Run makefile.launchDebug");
    await vscode.commands.executeCommand("makefile.launchDebug")

    // await new Promise(resolve => setTimeout(resolve, 5000));
  });
});