#!/bin/sh
set -eu

cd "$(dirname "$0")/../server"

go run honnef.co/go/tools/cmd/staticcheck@v0.8.2 ./...
go run github.com/go-critic/go-critic/cmd/gocritic@v0.15.0 check \
    -enable=appendAssign,argOrder,badCond,badLock,dupArg,dupCase,dupSubExpr,exitAfterDefer,flagDeref,nilValReturn,offBy1,regexpPattern,weakCond \
    ./...
