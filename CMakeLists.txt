cmake_minimum_required(VERSION 3.25)

project(bare_pipe C)

include(bare)

add_bare_module(bare_pipe)

target_sources(
  ${bare_pipe}
  PRIVATE
    binding.c
)
