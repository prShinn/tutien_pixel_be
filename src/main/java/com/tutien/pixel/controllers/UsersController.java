package com.tutien.pixel.controllers;

import com.tutien.pixel.entities.usersEntity;
import com.tutien.pixel.services.UsersService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/users")
public class UsersController {

    @Autowired
    private UsersService service;

    @GetMapping
    public List<usersEntity> all() {
        return service.findAll();
    }

    @GetMapping("/{id}")
    public ResponseEntity<?> get(@PathVariable int id) {
        return ResponseEntity.of(service.findById(id));
    }

    @PostMapping
    public usersEntity create(@RequestBody usersEntity u) {
        return service.create(u);
    }

    @PutMapping("/{id}")
    public usersEntity update(@PathVariable int id, @RequestBody usersEntity u) {
        return service.update(id, u);
    }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable int id) {
        service.delete(id);
    }
}