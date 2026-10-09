# MeshSync native engine — C++20 build
#
#   make            build bin/meshsync-native
#   make test       build + run the test suite (bin/test_meshsync)
#   make clean      remove build artifacts

CXX      := g++
CXXFLAGS := -std=c++20 -O2 -Wall -Wextra -pthread
CPPFLAGS := -Iinclude

SRC_DIR   := src
TEST_DIR  := tests
BIN_DIR   := bin

LIB_SRCS := $(SRC_DIR)/sha256.cpp \
            $(SRC_DIR)/json.cpp \
            $(SRC_DIR)/file_reader.cpp \
            $(SRC_DIR)/file_hasher.cpp \
            $(SRC_DIR)/chunker.cpp \
            $(SRC_DIR)/chunk_hash.cpp \
            $(SRC_DIR)/integrity_verifier.cpp \
            $(SRC_DIR)/file_scanner.cpp

WORKER_BIN := $(BIN_DIR)/meshsync-native
TEST_BIN   := $(BIN_DIR)/test_meshsync

.PHONY: all test clean bench

all: $(WORKER_BIN)

$(WORKER_BIN): $(LIB_SRCS) $(SRC_DIR)/main.cpp | $(BIN_DIR)
	$(CXX) $(CXXFLAGS) $(CPPFLAGS) -o $@ $(LIB_SRCS) $(SRC_DIR)/main.cpp

$(TEST_BIN): $(LIB_SRCS) $(TEST_DIR)/test_main.cpp | $(BIN_DIR)
	$(CXX) $(CXXFLAGS) $(CPPFLAGS) -o $@ $(LIB_SRCS) $(TEST_DIR)/test_main.cpp

$(BIN_DIR):
	mkdir -p $(BIN_DIR)

test: $(TEST_BIN) $(WORKER_BIN)
	$(TEST_BIN) $(WORKER_BIN)

# convenience: hashing throughput benchmark (prints to stderr)
bench: $(WORKER_BIN)
	$(WORKER_BIN) --bench

clean:
	rm -rf $(BIN_DIR)
