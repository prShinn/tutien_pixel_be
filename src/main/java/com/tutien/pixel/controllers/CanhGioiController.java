package com.tutien.pixel.controllers;

import com.tutien.pixel.entities.canhGioiEntity;
import com.tutien.pixel.services.CanhGioiService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/canh-gioi")
public class CanhGioiController {

    @Autowired
    private CanhGioiService service;

    @GetMapping
    public List<canhGioiEntity> all() {
        return service.all();
    }

    @GetMapping("/{id}")
    public ResponseEntity<?> get(@PathVariable int id) {
        return ResponseEntity.of(service.get(id));
    }

    @GetMapping("/stt/{stt}")
    public ResponseEntity<?> getByStt(@PathVariable int stt) {
        return ResponseEntity.of(service.getByStt(stt));
    }

    @PostMapping
    public canhGioiEntity create(@RequestBody canhGioiEntity e) {
        return service.create(e);
    }

    @PutMapping("/{id}")
    public canhGioiEntity update(@PathVariable int id, @RequestBody canhGioiEntity e) {
        return service.update(id, e);
    }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable int id) {
        service.delete(id);
    }
}
