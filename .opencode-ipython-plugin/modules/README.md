# Python Extension Modules

Place ".py" files in this directory to auto-load them into every IPython kernel for this project.

These modules are executed silently on kernel startup, after the prelude.

## Example

```python
# custom_helpers.py
def my_helper():
    return "Hello from custom helper!"
```

Then in any cell:
```python
my_helper()  # => "Hello from custom helper!"
```
