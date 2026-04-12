package com.tutien.pixel.controllers;

import com.tutien.pixel.entities.vatPhamEntity;
import com.tutien.pixel.services.VatPhamService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/vat-pham")
public class VatPhamController {

    @Autowired
    private VatPhamService service;

    @GetMapping("")
    public List<vatPhamEntity> getAll() {
        return service.getAll();
    }

    @GetMapping("/{id}")
    public vatPhamEntity getById(@PathVariable int id) {
        return service.getById(id);
    }

    @GetMapping("/code/{code}")
    public vatPhamEntity getByCode(@PathVariable String code) {
        return service.getByCode(code);
    }

    @PostMapping
    public vatPhamEntity create(@RequestBody vatPhamEntity v) {
        return service.create(v);
    }

    @PutMapping("/{id}")
    public vatPhamEntity update(@PathVariable int id, @RequestBody vatPhamEntity v) {
        return service.update(id, v);
    }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable int id) {
        service.deleteById(id);
    }

    @DeleteMapping("/code/{code}")
    public void deleteByCode(@PathVariable String code) {
        service.deleteByCode(code);
    }
}