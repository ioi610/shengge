// Native entry point for the dedicated Windows and Linux player.
package main

import (
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

func launch() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	root := filepath.Dir(exe)
	config, err := os.UserConfigDir()
	if err != nil {
		return err
	}
	profile := filepath.Join(config, "Shengge", "Practice")
	if err := os.MkdirAll(profile, 0700); err != nil {
		return err
	}
	browser := filepath.Join(root, "runtime", "chrome")
	page := filepath.ToSlash(filepath.Join(root, "Contents", "Resources", "ui", "training-launch.html"))
	if runtime.GOOS == "windows" {
		browser += ".exe"
		page = "/" + page
	}
	target := url.URL{Scheme: "file", Path: page, Fragment: "home"}
	cmd := exec.Command(browser, "--user-data-dir="+profile, "--load-extension="+filepath.Join(root, "training"), "--no-first-run", "--no-default-browser-check", "--window-size=1160,760", "--app="+target.String())
	// The installer check inspects a disposable profile through a loopback DevTools port.
	if len(os.Args) == 2 && os.Args[1] == "--verify-install" {
		cmd.Args = append(cmd.Args, "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1")
	}
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func main() {
	if err := launch(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		if dir, e := os.UserConfigDir(); e == nil {
			_ = os.WriteFile(filepath.Join(dir, "Shengge", "launch-error.txt"), []byte(err.Error()), 0600)
		}
		os.Exit(1)
	}
}
