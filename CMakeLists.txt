cmake_minimum_required(VERSION 3.25)

project(pear_pipe C)

include(pear)

add_pear_module(pear_pipe)

target_sources(
  pear_pipe
  PRIVATE
    binding.c
)
